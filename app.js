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

// ---- Init pokja dropdown ----
POKJA_ORDER.forEach(p => {
  const opt = document.createElement("option");
  opt.value = p;
  opt.textContent = `${p} — ${POKJA_NAMES[p]}`;
  pokjaSelect.appendChild(opt);
});

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
fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;
  hideError();

  for (const file of files) {
    const id = ++fileIdSeq;
    uploadedFiles.push({ id, name: file.name, text: "", pages: null, status: "reading" });
    renderFileList();

    const name = file.name.toLowerCase();
    try {
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
          showError(`"${file.name}" tampaknya hasil scan/foto (tanpa teks digital) — tidak ada teks yang bisa dibaca. Coba unggah versi Word-nya, atau ketik ulang isinya ke kotak dokumen.`);
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
    const pagesInfo = f.status === "reading" ? "membaca..." : f.status === "error" ? "gagal" : (f.pages ? `${f.pages} hlm` : `${f.text.length.toLocaleString("id-ID")} kar`);
    chip.innerHTML = `<span class="name">${escapeHtml(f.name)}</span><span class="pages">${pagesInfo}</span>`;
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
    if (f.text) parts.push(`=== DOKUMEN: ${f.name} ===\n${f.text}`);
  });
  return parts.join("\n\n");
}

docTextEl.addEventListener("input", updateCharCount);
function updateCharCount() {
  charCount.textContent = combinedDocText().length.toLocaleString("id-ID") + " karakter total";
}

function showError(msg) { errorBox.textContent = msg; errorBox.classList.remove("hidden"); }
function hideError() { errorBox.classList.add("hidden"); }
function clearResults() { results = null; resultsSection.classList.add("hidden"); epResultsEl.innerHTML = ""; }

// ---- Call backend (proxy to Anthropic API), dengan retry otomatis ----
async function callBackend(system, prompt, retries = 2) {
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
        body: JSON.stringify({ system, prompt, maxTokens: 700 }),
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

// Versi yang mengembalikan teks mentah (bukan JSON) — dipakai untuk generate draft dokumen panjang.
async function callBackendRaw(system, prompt, maxTokens = 3500, retries = 1) {
  if (!API_ENDPOINT || API_ENDPOINT.indexOf("GANTI_DENGAN") === 0) {
    throw new Error("API_ENDPOINT belum dikonfigurasi.");
  }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ system, prompt, maxTokens }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.result.trim();
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
  if (!docText) { showError("Tempel atau unggah dokumen terlebih dahulu."); return; }
  hideError();
  clearResults();

  runBtn.disabled = true;
  runIcon.textContent = "⏳";

  const system = "Anda adalah surveyor akreditasi rumah sakit berpengalaman yang menilai kelengkapan dokumen terhadap Instrumen Survei Akreditasi Rumah Sakit (Kepdirjen Yankes No. HK.02.02/D/47104/2024). Anda bersikap objektif, teliti, dan tidak mengarang bukti yang tidak ada dalam dokumen. Anda HANYA merespons dengan JSON valid, tanpa teks lain, tanpa markdown code fence.";

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
${docText.slice(0, 60000)}
"""

Tugas Anda: nilai apakah dokumen di atas memenuhi elemen penilaian ini. Berikan penilaian objektif berdasarkan isi dokumen yang benar-benar ada, jangan mengasumsikan sesuatu yang tidak disebutkan.

Balas HANYA dengan JSON berikut (tanpa markdown fence, tanpa teks tambahan):
{"status":"Terpenuhi|Sebagian|Tidak Ada","skor":${maxSkor === 10 ? '"10 atau 5 atau 0"' : '"angka sesuai skala"'},"kajian":"analisa singkat 1-2 kalimat tentang apa yang ditemukan/tidak ditemukan dalam dokumen","rekomendasi":"1 kalimat saran konkret untuk melengkapi jika belum terpenuhi, atau kosongkan jika sudah Terpenuhi penuh"}`;

    let entryResult;
    try {
      const parsed = await callBackend(system, prompt);
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
  btn.disabled = true;
  btn.textContent = "⏳ Membuat draft...";

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
    const raw = await callBackendRaw(system, prompt, 3500);
    box.innerHTML = `
      <div class="draft-box">
        <div class="draft-box-head">
          <span class="title">DRAFT DOKUMEN</span>
          <div class="draft-box-actions">
            <button class="copy-btn">Salin</button>
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
    btn.textContent = "📝 Buat Ulang Draft";
    btn.disabled = false;
  } catch (err) {
    box.innerHTML = `<div class="error-box" style="margin-top:10px;">Gagal membuat draft: ${escapeHtml(err.message)}</div>`;
    btn.textContent = "📝 Buatkan Draft Pemenuhan";
    btn.disabled = false;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Boot ----
refreshStandarDropdown();
