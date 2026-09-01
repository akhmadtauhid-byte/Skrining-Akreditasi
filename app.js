// =====================================================================
// KONFIGURASI — ganti dengan URL Web App Google Apps Script Anda
// (lihat petunjuk setup di bagian atas file Code.gs)
// =====================================================================
const API_ENDPOINT = "GANTI_DENGAN_URL_WEB_APP_GOOGLE_APPS_SCRIPT_ANDA";

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

// ---- Call backend (proxy to Anthropic API) ----
async function callBackend(system, prompt) {
  if (!API_ENDPOINT || API_ENDPOINT.indexOf("GANTI_DENGAN") === 0) {
    throw new Error("API_ENDPOINT belum dikonfigurasi. Buka app.js dan isi dengan URL Web App Google Apps Script Anda.");
  }
  // Dikirim sebagai text/plain agar tidak memicu CORS preflight pada Google Apps Script.
  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ system, prompt }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  let raw = data.result.trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
  return JSON.parse(raw);
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

  let done = 0;
  const total = currentEpList.length;
  runLabel.textContent = `Menganalisis... (0/${total})`;

  const settled = await Promise.all(currentEpList.map(async (ep) => {
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

    try {
      const parsed = await callBackend(system, prompt);
      done++; runLabel.textContent = `Menganalisis... (${done}/${total})`;
      return { ep, ...parsed };
    } catch (err) {
      done++; runLabel.textContent = `Menganalisis... (${done}/${total})`;
      return { ep, status: "Tidak Ada", skor: 0, kajian: "Gagal menganalisis (" + err.message + ")", rekomendasi: "Coba jalankan ulang analisis." };
    }
  }));

  results = settled;
  renderResults();

  runBtn.disabled = false;
  runIcon.textContent = "✨";
  runLabel.textContent = "Jalankan Analisis AI";
}

function statusMeta(status) {
  if (status === "Terpenuhi") return { cls: "ok", icon: "✓", label: "Terpenuhi" };
  if (status === "Sebagian") return { cls: "warn", icon: "⚠", label: "Sebagian" };
  return { cls: "bad", icon: "✕", label: "Tidak Ada" };
}

function renderResults() {
  let total = 0, max = 0;
  const counts = { Terpenuhi: 0, Sebagian: 0, "Tidak Ada": 0 };
  results.forEach(r => {
    max += skorMax(r.ep.skor);
    const s = typeof r.skor === "number" ? r.skor : parseInt(r.skor) || 0;
    total += s;
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  const pct = max ? Math.round((total / max) * 100) : 0;

  document.getElementById("statSkor").textContent = `${total}/${max}`;
  const statPct = document.getElementById("statPct");
  statPct.textContent = pct + "%";
  statPct.style.color = pct >= 80 ? "var(--ok-fg)" : pct >= 50 ? "var(--warn-fg)" : "var(--bad-fg)";
  document.getElementById("statOk").textContent = counts["Terpenuhi"] || 0;
  document.getElementById("statBad").textContent = (counts["Sebagian"] || 0) + (counts["Tidak Ada"] || 0);

  epResultsEl.innerHTML = "";
  results.forEach(r => {
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
    `;
    epResultsEl.appendChild(card);
  });

  resultsSection.classList.remove("hidden");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Boot ----
refreshStandarDropdown();
