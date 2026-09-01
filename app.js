// =====================================================================
// KONFIGURASI — ganti dengan URL Web App Google Apps Script Anda
// (lihat petunjuk setup di bagian atas file Code.gs)
// =====================================================================
const API_ENDPOINT = "https://script.google.com/macros/s/AKfycbz1qMHx5g34RneKa2wQzHHg-cmze39nk4qQVrAJiB1FvdZFdjUBjvuuauev6_GE8s8K/exec";

const POKJA_NAMES = {
  TKRS: "Tata Kelola Rumah Sakit", KPS: "Kualifikasi dan Pendidikan Staf",
  MFK: "Manajemen Fasilitas dan Keselamatan", PMKP: "Peningkatan Mutu dan Keselamatan Pasien",
  MRMIK: "Manajemen Rekam Medis dan Informasi Kesehatan", PPI: "Pencegahan dan Pengendalian Infeksi",
  PPK: "Pendidikan dalam Pelayanan Kesehatan", AKP: "Akses dan Kontinuitas Pelayanan",
  HPK: "Hak Pasien dan Keluarga", PP: "Pengkajian Pasien", PAP: "Pelayanan dan Asuhan Pasien",
  PAB: "Pelayanan Anestesi dan Bedah", PKPO: "Pelayanan Kefarmasian dan Penggunaan Obat",
  KE: "Komunikasi dan Edukasi", SKP: "Sasaran Keselamatan Pasien", PROGNAS: "Program Nasional",
};
const POKJA_ORDER = ["TKRS","KPS","MFK","PMKP","MRMIK","PPI","PPK","AKP","HPK","PP","PAP","PAB","PKPO","KE","SKP","PROGNAS"];
const BUKTI_LABEL = { R: "Regulasi", D: "Dokumen", W: "Wawancara", O: "Observasi", S: "Simulasi" };

function bukiLabelFull(code) {
  if (!code) return "";
  return code.trim().split(/\s+/).map(c => BUKTI_LABEL[c] || c).join(" / ");
}
function skorMax(skorStr) {
  const nums = (skorStr || "").split(/[^0-9]+/).filter(Boolean).map(Number);
  return nums.length ? Math.max(...nums) : 10;
}

// ---- State ----
let currentPokja = "TKRS";
let draftQueue = Promise.resolve(); // antrean supaya draft diproses satu per satu, tidak tabrakan
let currentStandar = "";
let currentEpList = [];
let results = null;
let uploadedFiles = []; // [{id, name, text, pages}]
let fileIdSeq = 0;

// ---- DOM refs ----
const pokjaSelect = document.getElementById("pokjaSelect");
const standarSelect = document.getElementById("standarSelect");
const standarBox = document.getElementById("standarBox");
const standarLabel = document.getElementById("standarLabel");
const standarText = document.getElementById("standarText");
const epCount = document.getElementById("epCount");
const docTextEl = document.getElementById("docText");
const fileInput = document.getElementById("fileInput");
const fileLabel = document.getElementById("fileLabel");
const fileListEl = document.getElementById("fileList");
const charCount = document.getElementById("charCount");
const errorBox = document.getElementById("errorBox");
const runBtn = document.getElementById("runBtn");
const runIcon = document.getElementById("runIcon");
const runLabel = document.getElementById("runLabel");
const resultsSection = document.getElementById("resultsSection");
const epResultsEl = document.getElementById("epResults");

// ---- Init pokja dropdown (akan diisi ulang sesuai hak akses setelah login, lihat populatePokjaDropdown) ----
function populatePokjaDropdown(allowedPokja) {
  pokjaSelect.innerHTML = "";
  const isAll = !allowedPokja || allowedPokja.includes("ALL");
  const list = isAll ? POKJA_ORDER : POKJA_ORDER.filter(p => allowedPokja.includes(p));
  list.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = `${p} — ${POKJA_NAMES[p]}`;
    pokjaSelect.appendChild(opt);
  });
  if (list.length) currentPokja = list[0];
}

function getStandarListForPokja(pokja) {
  const map = new Map();
  EP_DATA.filter(e => e.pokja === pokja).forEach(e => {
    if (!map.has(e.std)) map.set(e.std, e.stdTxt);
  });
  return Array.from(map.entries());
}

function refreshStandarDropdown() {
  const list = getStandarListForPokja(currentPokja);
  standarSelect.innerHTML = "";
  list.forEach(([code]) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code;
    standarSelect.appendChild(opt);
  });
  if (list.length) {
    currentStandar = list[0][0];
    standarSelect.value = currentStandar;
  }
  refreshStandarBox();
}

function refreshStandarBox() {
  const list = getStandarListForPokja(currentPokja);
  const entry = list.find(([c]) => c === currentStandar);
  currentEpList = EP_DATA.filter(e => e.pokja === currentPokja && e.std === currentStandar);
  if (entry) {
    standarBox.classList.remove("hidden");
    standarLabel.textContent = "BUNYI STANDAR " + currentStandar;
    standarText.textContent = entry[1];
    epCount.textContent = currentEpList.length + " Elemen Penilaian pada standar ini";
  } else {
    standarBox.classList.add("hidden");
  }
  clearResults();
}

pokjaSelect.addEventListener("change", () => {
  currentPokja = pokjaSelect.value;
  refreshStandarDropdown();
});
standarSelect.addEventListener("change", () => {
  currentStandar = standarSelect.value;
  refreshStandarBox();
});

// ---- File upload (mendukung banyak file sekaligus) ----
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const IMAGE_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;
  hideError();

  for (const file of files) {
    const id = ++fileIdSeq;
    const name = file.name.toLowerCase();
    const isImage = IMAGE_EXT.some(ext => name.endsWith(ext));
    uploadedFiles.push({ id, name: file.name, text: "", pages: null, status: "reading", isImage, mediaType: "", dataBase64: "" });
    renderFileList();

    try {
      if (isImage) {
        const ext = name.split(".").pop();
        const mediaType = IMAGE_MIME[ext] || "image/jpeg";
        const arrayBuffer = await file.arrayBuffer();
        const dataBase64 = arrayBufferToBase64(arrayBuffer);
        const f = uploadedFiles.find(x => x.id === id);
        f.mediaType = mediaType; f.dataBase64 = dataBase64; f.status = "done";
      } else {
        let text = "", pages = null;
        if (name.endsWith(".pdf")) {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          pages = pdf.numPages;
          let fullText = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            fullText += content.items.map(item => item.str).join(" ") + "\n\n";
          }
          text = fullText.trim();
          if (!text) {
            showError(`"${file.name}" tampaknya hasil scan/foto (tanpa teks digital). Coba unggah sebagai foto/gambar (.jpg/.png) langsung — AI bisa membaca isi gambar, atau unggah versi Word-nya.`);
          }
        } else if (name.endsWith(".docx")) {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          text = result.value;
        } else {
          text = await file.text();
        }
        const f = uploadedFiles.find(x => x.id === id);
        f.text = text; f.pages = pages; f.status = "done";
      }
    } catch (err) {
      const f = uploadedFiles.find(x => x.id === id);
      f.status = "error"; f.text = "";
      showError(`Gagal membaca "${file.name}": ` + err.message);
    }
    renderFileList();
    updateCharCount();
  }

  fileInput.value = ""; // reset supaya file yang sama bisa diunggah ulang jika perlu
});

function removeFile(id) {
  uploadedFiles = uploadedFiles.filter(f => f.id !== id);
  renderFileList();
  updateCharCount();
}

function renderFileList() {
  fileListEl.innerHTML = "";
  uploadedFiles.forEach(f => {
    const chip = document.createElement("div");
    chip.className = "file-chip" + (f.status === "reading" ? " reading" : "");
    let info;
    if (f.status === "reading") info = "membaca...";
    else if (f.status === "error") info = "gagal";
    else if (f.isImage) info = "🖼 gambar";
    else info = f.pages ? `${f.pages} hlm` : `${f.text.length.toLocaleString("id-ID")} kar`;
    chip.innerHTML = `<span class="name">${escapeHtml(f.name)}</span><span class="pages">${info}</span>`;
    const btn = document.createElement("button");
    btn.className = "remove";
    btn.textContent = "✕";
    btn.title = "Hapus file ini";
    btn.addEventListener("click", () => removeFile(f.id));
    chip.appendChild(btn);
    fileListEl.appendChild(chip);
  });
}

function combinedDocText() {
  const parts = [];
  const manual = docTextEl.value.trim();
  if (manual) parts.push(manual);
  uploadedFiles.forEach(f => {
    if (!f.isImage && f.text) parts.push(`=== DOKUMEN: ${f.name} ===\n${f.text}`);
  });
  return parts.join("\n\n");
}

function combinedImages() {
  return uploadedFiles
    .filter(f => f.isImage && f.dataBase64)
    .map(f => ({ mediaType: f.mediaType, data: f.dataBase64 }));
}

docTextEl.addEventListener("input", updateCharCount);
function updateCharCount() {
  charCount.textContent = combinedDocText().length.toLocaleString("id-ID") + " karakter total";
}

function showError(msg) { errorBox.textContent = msg; errorBox.classList.remove("hidden"); }
function hideError() { errorBox.classList.add("hidden"); }
function clearResults() { results = null; resultsSection.classList.add("hidden"); epResultsEl.innerHTML = ""; }

// ---- Call backend (proxy to Anthropic API), dengan retry otomatis ----
async function callBackend(system, prompt, images = [], retries = 2) {
  if (!API_ENDPOINT || API_ENDPOINT.indexOf("GANTI_DENGAN") === 0) {
    throw new Error("API_ENDPOINT belum dikonfigurasi. Buka app.js dan isi dengan URL Web App Google Apps Script Anda.");
  }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Dikirim sebagai text/plain agar tidak memicu CORS preflight pada Google Apps Script.
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ system, prompt, images, maxTokens: 700, pokja: currentPokja, allowedPokja: session && session.allowedPokja }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      let raw = data.result.trim();
      raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
      return JSON.parse(raw);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Versi yang mengembalikan teks mentah + stopReason (bukan JSON) — dipakai untuk generate draft dokumen panjang.
async function callBackendRaw(system, prompt, maxTokens = 3500, images = [], retries = 1) {
  if (!API_ENDPOINT || API_ENDPOINT.indexOf("GANTI_DENGAN") === 0) {
    throw new Error("API_ENDPOINT belum dikonfigurasi.");
  }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ system, prompt, images, maxTokens, pokja: currentPokja, allowedPokja: session && session.allowedPokja }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return { text: data.result.trim(), stopReason: data.stopReason };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

// ---- Run analysis ----
runBtn.addEventListener("click", runAnalysis);

async function runAnalysis() {
  const docText = combinedDocText();
  const images = combinedImages();
  if (!docText && !images.length) { showError("Tempel atau unggah dokumen terlebih dahulu."); return; }
  hideError();
  clearResults();

  runBtn.disabled = true;
  runIcon.textContent = "⏳";

  const system = "Anda adalah surveyor akreditasi rumah sakit berpengalaman yang menilai kelengkapan dokumen terhadap Instrumen Survei Akreditasi Rumah Sakit (Kepdirjen Yankes No. HK.02.02/D/47104/2024). Anda bersikap objektif, teliti, dan tidak mengarang bukti yang tidak ada dalam dokumen — termasuk dokumen berupa foto/gambar yang disertakan, baca isinya langsung dari gambar. Anda HANYA merespons dengan JSON valid, tanpa teks lain, tanpa markdown code fence.";

  const entry = getStandarListForPokja(currentPokja).find(([c]) => c === currentStandar);
  const stdTextFull = entry ? entry[1] : "";

  const total = currentEpList.length;
  results = [];
  resultsSection.classList.remove("hidden");
  epResultsEl.innerHTML = "";
  renderSummary(); // tampilkan ringkasan kosong dulu

  for (let i = 0; i < currentEpList.length; i++) {
    const ep = currentEpList[i];
    runLabel.textContent = `Menganalisis... (${i}/${total})`;
    const maxSkor = skorMax(ep.skor);
    const prompt = `STANDAR: ${currentStandar}
BUNYI STANDAR: ${stdTextFull}

ELEMEN PENILAIAN (EP):
"${ep.ep}"

JENIS BUKTI YANG DIPERLUKAN: ${bukiLabelFull(ep.bukti)}
DESKRIPSI BUKTI YANG DIPERSYARATKAN: ${ep.buktiDesc}
SKALA SKOR YANG BERLAKU: ${ep.skor}

DOKUMEN RUMAH SAKIT YANG DIUNGGAH (untuk dinilai):
"""
${docText.slice(0, 60000) || "(tidak ada teks yang ditempel — dokumen dilampirkan sebagai gambar/foto, baca langsung isinya dari gambar terlampir)"}
"""
${images.length ? `\n${images.length} lembar dokumen juga dilampirkan sebagai gambar/foto — baca dan gunakan isinya sebagai bukti tambahan.` : ""}

Tugas Anda: nilai apakah dokumen di atas memenuhi elemen penilaian ini. Berikan penilaian objektif berdasarkan isi dokumen yang benar-benar ada, jangan mengasumsikan sesuatu yang tidak disebutkan.

Balas HANYA dengan JSON berikut (tanpa markdown fence, tanpa teks tambahan):
{"status":"Terpenuhi|Sebagian|Tidak Ada","skor":${maxSkor === 10 ? '"10 atau 5 atau 0"' : '"angka sesuai skala"'},"kajian":"analisa singkat 1-2 kalimat tentang apa yang ditemukan/tidak ditemukan dalam dokumen","rekomendasi":"1 kalimat saran konkret untuk melengkapi jika belum terpenuhi, atau kosongkan jika sudah Terpenuhi penuh"}`;

    let entryResult;
    try {
      const parsed = await callBackend(system, prompt, images);
      entryResult = { ep, ...parsed };
    } catch (err) {
      entryResult = { ep, status: "Tidak Ada", skor: 0, kajian: "Gagal menganalisis setelah beberapa percobaan (" + err.message + ")", rekomendasi: "Coba klik \"Jalankan Analisis AI\" lagi." };
    }
    results.push(entryResult);
    appendResultCard(entryResult, i);
    renderSummary();
    runLabel.textContent = `Menganalisis... (${i + 1}/${total})`;
  }

  runBtn.disabled = false;
  runIcon.textContent = "✨";
  runLabel.textContent = "Jalankan Analisis AI";
}

function statusMeta(status) {
  if (status === "Terpenuhi") return { cls: "ok", icon: "✓", label: "Terpenuhi" };
  if (status === "Sebagian") return { cls: "warn", icon: "⚠", label: "Sebagian" };
  return { cls: "bad", icon: "✕", label: "Tidak Ada" };
}

function renderSummary() {
  let total = 0, max = 0;
  const counts = { Terpenuhi: 0, Sebagian: 0, "Tidak Ada": 0 };
  results.forEach(r => {
    max += skorMax(r.ep.skor);
    const s = typeof r.skor === "number" ? r.skor : parseInt(r.skor) || 0;
    total += s;
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  // total skor maksimal ditampilkan berdasarkan seluruh EP standar (bukan cuma yang sudah dinilai)
  const fullMax = currentEpList.reduce((sum, ep) => sum + skorMax(ep.skor), 0);
  const pct = fullMax ? Math.round((total / fullMax) * 100) : 0;

  document.getElementById("statSkor").textContent = `${total}/${fullMax}`;
  const statPct = document.getElementById("statPct");
  statPct.textContent = pct + "%";
  statPct.style.color = pct >= 80 ? "var(--ok-fg)" : pct >= 50 ? "var(--warn-fg)" : "var(--bad-fg)";
  document.getElementById("statOk").textContent = counts["Terpenuhi"] || 0;
  document.getElementById("statBad").textContent = (counts["Sebagian"] || 0) + (counts["Tidak Ada"] || 0);
}

function appendResultCard(r, idx) {
  const meta = statusMeta(r.status);
  const card = document.createElement("div");
  card.className = "ep-card";
  card.innerHTML = `
    <div class="ep-head">
      <p class="ep-text">${escapeHtml(r.ep.ep)}</p>
      <span class="badge ${meta.cls}">${meta.icon} ${meta.label} · ${r.skor}</span>
    </div>
    <div class="bukti-line">Bukti diperlukan: ${escapeHtml(bukiLabelFull(r.ep.bukti))}</div>
    <p class="kajian"><b>Kajian AI: </b>${escapeHtml(r.kajian || "")}</p>
    ${r.rekomendasi ? `<p class="rekomendasi"><b>Rekomendasi: </b>${escapeHtml(r.rekomendasi)}</p>` : ""}
    <div class="draft-btn-row">
      <button class="draft-btn" id="draftBtn-${idx}">📝 Buatkan Draft Pemenuhan</button>
    </div>
    <div id="draftBox-${idx}"></div>
  `;
  epResultsEl.appendChild(card);
  document.getElementById(`draftBtn-${idx}`).addEventListener("click", () => generateDraft(idx, r));
}

async function generateDraft(idx, r) {
  const btn = document.getElementById(`draftBtn-${idx}`);
  const box = document.getElementById(`draftBox-${idx}`);
  if (btn.disabled) return; // sudah diproses/antre
  btn.disabled = true;
  btn.textContent = "⏳ Menunggu antrean...";

  // Jalankan lewat antrean supaya tidak ada 2 permintaan draft bersamaan ke backend.
  draftQueue = draftQueue.then(() => runDraftGeneration(idx, r, btn, box));
  return draftQueue;
}

async function runDraftGeneration(idx, r, btn, box) {
  btn.textContent = "⏳ Membuat draft...";
  const images = combinedImages();

  const entry = getStandarListForPokja(currentPokja).find(([c]) => c === currentStandar);
  const stdTextFull = entry ? entry[1] : "";
  const jenisOptions = Object.keys(RS_PROFILE.sistematika).map(k => `- ${k}: ${RS_PROFILE.sistematika[k].join(" | ")}`).join("\n");

  const system = `Anda adalah staf Tim Regulasi/Akreditasi RSU Allam Medica Bumiayu yang membuat draft dokumen resmi siap-edit untuk memenuhi Elemen Penilaian akreditasi. Draft harus mengikuti persis identitas dan format tata naskah dinas RSU Allam Medica berikut (JSON):
${JSON.stringify(RS_PROFILE)}

ATURAN WAJIB (jangan dilanggar):
1. SEMUA regulasi (baik "Peraturan Direktur" maupun "Keputusan/SK Direktur") DITETAPKAN DAN DITANDATANGANI OLEH DIREKTUR (dr. Hardyansyah, MPH-MMR) — BUKAN oleh Pemilik/Yayasan/Dewan Pengawas. Jangan pernah menulis "PEMILIK RSU ALLAM MEDICA" sebagai penerbit dokumen.
2. Jika jenis dokumen berupa Kebijakan/SK, gunakan PERSIS struktur "boilerplateSK" di atas (judul "KEPUTUSAN DIREKTUR...", nomor pakai kode "SK").
3. Jika jenis dokumen berupa Pedoman/Panduan/Program Kerja (butuh Peraturan Direktur sebagai payung + lampiran isi), gunakan PERSIS struktur "boilerplatePeraturanDirektur" di atas (judul "PERATURAN DIREKTUR...", nomor pakai kode "PER"), lalu lanjutkan dengan isi lampiran sesuai sistematika jenis dokumennya (BAB per BAB, lengkap).
4. Jika jenis dokumen berupa SPO, gunakan format kotak SPO sesuai "sistematika.SPO" — JANGAN pakai boilerplate SK/Peraturan Direktur untuk SPO.
5. JANGAN mencampur dua judul/jenis dalam satu dokumen (mis. judul "KEPUTUSAN" tapi nomor pakai kode "PER", atau sebaliknya) — pilih satu dan konsisten dari awal sampai akhir.

Pilih SATU jenis dokumen yang paling tepat untuk EP ini dari daftar sistematika (Program Kerja / Pedoman Pengorganisasian / Pedoman Pelayanan-Penyelenggaraan / Panduan / SPO / Kebijakan-SK Direktur). Tulis draft LENGKAP dan SUBSTANTIF (bukan kerangka kosong) — isi dengan konten yang masuk akal dan konkret untuk RSU Allam Medica, sesuai konteks EP yang diberikan. Tandai bagian yang wajib diisi manual oleh RS (nomor dokumen final, tanggal pasti) dengan format [ISI: keterangan]. Jangan gunakan markdown heading (#) — gunakan format naskah dinas biasa (BAB, huruf kapital, dsb). Balas HANYA dengan teks draft dokumennya saja, tanpa basa-basi pembuka/penutup.`;

  const prompt = `STANDAR: ${currentStandar}
BUNYI STANDAR: ${stdTextFull}

ELEMEN PENILAIAN YANG PERLU DIPENUHI:
"${r.ep.ep}"

JENIS BUKTI YANG DIPERSYARATKAN: ${bukiLabelFull(r.ep.bukti)}
DESKRIPSI BUKTI: ${r.ep.buktiDesc}

HASIL KAJIAN SEBELUMNYA (status saat ini: ${r.status}):
${r.kajian}
${r.rekomendasi ? "Rekomendasi: " + r.rekomendasi : ""}

Buatkan draft dokumen yang jika diterbitkan akan memenuhi elemen penilaian ini sepenuhnya (skor maksimal).`;

  try {
    btn.textContent = "⏳ Membuat draft...";
    let raw = "";
    let stopReason = "";
    let continuePrompt = prompt;
    const MAX_ROUNDS = 4; // maksimal 4x8000 token ≈ dokumen sangat panjang, cukup untuk Pedoman 12 BAB sekalipun
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (round > 0) btn.textContent = `⏳ Melanjutkan draft (bagian ${round + 1})...`;
      const res = await callBackendRaw(system, continuePrompt, 8000, images);
      raw += (round > 0 ? "\n" : "") + res.text;
      stopReason = res.stopReason;
      if (stopReason !== "max_tokens") break; // selesai natural, tidak perlu lanjut
      continuePrompt = `Draft yang sudah ditulis sejauh ini (JANGAN diulang, lanjutkan persis dari kata terakhir tanpa mengulang):\n"""\n${raw.slice(-4000)}\n"""\n\nLanjutkan draft dokumen ini sampai benar-benar selesai (termasuk bagian penutup/tanda tangan jika relevan). Balas HANYA lanjutan teksnya saja.`;
    }

    box.innerHTML = `
      <div class="draft-box">
        <div class="draft-box-head">
          <span class="title">DRAFT DOKUMEN${stopReason === "max_tokens" ? " (mungkin masih terpotong)" : ""}</span>
          <div class="draft-box-actions">
            <button class="copy-btn">Salin</button>
            <button class="docx-btn">⬇ Unduh .docx</button>
            <button class="download-btn">Unduh .txt</button>
          </div>
        </div>
        <pre>${escapeHtml(raw)}</pre>
      </div>
    `;
    box.querySelector(".copy-btn").addEventListener("click", async (ev) => {
      await navigator.clipboard.writeText(raw);
      ev.target.textContent = "Tersalin ✓";
      setTimeout(() => { ev.target.textContent = "Salin"; }, 1500);
    });
    box.querySelector(".download-btn").addEventListener("click", () => {
      const blob = new Blob([raw], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Draft_${currentStandar.replace(/\s+/g, "_")}_${idx + 1}.txt`;
      a.click();
    });
    box.querySelector(".docx-btn").addEventListener("click", (ev) => {
      downloadAsDocx(raw, `Draft_${currentStandar.replace(/\s+/g, "_")}_${idx + 1}.docx`, ev.target);
    });
    btn.textContent = "📝 Buat Ulang Draft";
    btn.disabled = false;
  } catch (err) {
    box.innerHTML = `<div class="error-box" style="margin-top:10px;">Gagal membuat draft: ${escapeHtml(err.message)}</div>`;
    btn.textContent = "📝 Buatkan Draft Pemenuhan";
    btn.disabled = false;
  }
}

// ---- Konversi teks draft menjadi file Word (.docx) asli ----
function downloadAsDocx(rawText, filename, btnEl) {
  const originalLabel = btnEl.textContent;
  btnEl.textContent = "⏳ Membuat .docx...";
  try {
    const { Document, Packer, Paragraph, TextRun, AlignmentType } = docx;
    const lines = rawText.split("\n");
    const children = [];

    const isAllCapsHeading = (line) => {
      const t = line.trim();
      if (!t || t.length > 90) return false;
      const letters = t.replace(/[^A-Za-z]/g, "");
      return letters.length > 2 && letters === letters.toUpperCase();
    };
    const isBabHeading = (line) => /^(BAB\s+[IVXLC]+|[IVXLC]+\.\s|KESATU|KEDUA|KETIGA|KEEMPAT|KELIMA|MENIMBANG|MENGINGAT|MEMUTUSKAN|MENETAPKAN)\b/i.test(line.trim());

    lines.forEach((line) => {
      const t = line.trim();
      if (!t) {
        children.push(new Paragraph({ text: "" }));
        return;
      }
      const heading = isAllCapsHeading(t) || isBabHeading(t);
      children.push(new Paragraph({
        alignment: isAllCapsHeading(t) && t.length < 60 ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { after: 120 },
        children: [new TextRun({ text: t, bold: heading, size: 22, font: "Arial" })],
      }));
    });

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } },
        children,
      }],
    });

    Packer.toBlob(doc).then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      btnEl.textContent = originalLabel;
    }).catch((err) => {
      alert("Gagal membuat file .docx: " + err.message);
      btnEl.textContent = originalLabel;
    });
  } catch (err) {
    alert("Gagal membuat file .docx: " + err.message + " (pastikan koneksi internet aktif, library docx perlu dimuat dari CDN)");
    btnEl.textContent = originalLabel;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===================== LOGIN & SESI PENGGUNA =====================
const loginScreen = document.getElementById("loginScreen");
const mainApp = document.getElementById("mainApp");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const userLabel = document.getElementById("userLabel");
const logoutBtn = document.getElementById("logoutBtn");

let session = null; // { nama, role, allowedPokja }

function saveSession(s) { localStorage.setItem("skrining_session", JSON.stringify(s)); }
function loadSession() {
  try { return JSON.parse(localStorage.getItem("skrining_session")); } catch (e) { return null; }
}
function clearSession() { localStorage.removeItem("skrining_session"); }

async function doLogin() {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username || !password) {
    loginError.textContent = "Username dan password wajib diisi.";
    loginError.classList.remove("hidden");
    return;
  }
  if (!API_ENDPOINT || API_ENDPOINT.indexOf("GANTI_DENGAN") === 0) {
    loginError.textContent = "API_ENDPOINT belum dikonfigurasi di app.js.";
    loginError.classList.remove("hidden");
    return;
  }
  loginBtn.disabled = true;
  loginBtn.textContent = "Memeriksa...";
  loginError.classList.add("hidden");
  try {
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "login", username, password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Login gagal.");
    session = { nama: data.nama, role: data.role, allowedPokja: data.allowedPokja };
    saveSession(session);
    enterApp();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove("hidden");
  }
  loginBtn.disabled = false;
  loginBtn.textContent = "Masuk";
}

function enterApp() {
  loginScreen.classList.add("hidden");
  mainApp.classList.remove("hidden");
  const isAll = session.allowedPokja.includes("ALL");
  userLabel.textContent = `👤 ${session.nama}${isAll ? " (Admin — semua pokja)" : " — Pokja: " + session.allowedPokja.join(", ")}`;
  populatePokjaDropdown(session.allowedPokja);
  refreshStandarDropdown();
}

loginBtn.addEventListener("click", doLogin);
loginPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
logoutBtn.addEventListener("click", () => {
  clearSession();
  session = null;
  mainApp.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  loginUsername.value = ""; loginPassword.value = "";
});

// ---- Boot ----
const existingSession = loadSession();
if (existingSession && existingSession.allowedPokja) {
  session = existingSession;
  enterApp();
} else {
  loginScreen.classList.remove("hidden");
}
