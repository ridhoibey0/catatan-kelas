const config = window.APP_CONFIG || {};
const API_BASE_URL = config.API_BASE_URL || "";
const DEFAULT_MONTHLY_AMOUNT = Number(config.DEFAULT_MONTHLY_AMOUNT || 0);

const MONTH_COLUMNS = {
  Januari: 1,
  Februari: 2,
  Maret: 3,
  April: 4,
  Mei: 5,
  Juni: 6,
  Juli: 7,
  Agustus: 8,
  September: 9,
  Oktober: 10,
  November: 11,
  Desember: 12
};
const MONTH_ORDER = Object.keys(MONTH_COLUMNS);

const rawCategories = Array.isArray(config.CATEGORIES) && config.CATEGORIES.length
  ? config.CATEGORIES
  : [
      {
        key: "default",
        label: "Pembayaran",
        sheet: config.DEFAULT_SPREADSHEET_TAB || "Transaksi",
        monthlyTarget: DEFAULT_MONTHLY_AMOUNT
      }
    ];

const categories = rawCategories.map(cat => ({
  key: cat.key,
  label: cat.label || cat.key,
  sheet: cat.sheet || config.DEFAULT_SPREADSHEET_TAB || "Transaksi",
  monthlyTarget: Number(cat.monthlyTarget ?? DEFAULT_MONTHLY_AMOUNT ?? 0)
}));

const categoryMap = Object.fromEntries(categories.map(cat => [cat.key, cat]));
const DEFAULT_CATEGORY_KEY = categoryMap[config.DEFAULT_CATEGORY]
  ? config.DEFAULT_CATEGORY
  : categories[0].key;

const STATUS_OPTIONS = [
  { value: "ALL", label: "Semua status" },
  { value: "LUNAS", label: "Lunas" },
  { value: "CICIL", label: "Masih cicil" },
  { value: "BELUM", label: "Belum bayar" },
  { value: "TERCATAT", label: "Nominal tercatat" }
];

const state = {
  payments: [],
  filters: {
    query: "",
    status: "ALL",
    month: "ALL"
  },
  loading: false,
  categoryKey: DEFAULT_CATEGORY_KEY
};

const elements = {
  form: document.querySelector("#paymentForm"),
  summary: document.querySelector("#summaryCards"),
  summarySubtitle: document.querySelector("#summarySubtitle"),
  formSubtitle: document.querySelector("#formSubtitle"),
  tableBody: document.querySelector("#paymentsTable tbody"),
  tableEmpty: document.querySelector("#tableEmpty"),
  tableSubtitle: document.querySelector("#tableSubtitle"),
  activity: document.querySelector("#activityList"),
  activitySubtitle: document.querySelector("#activitySubtitle"),
  searchInput: document.querySelector("#filterSearch"),
  statusSelect: document.querySelector("#filterStatus"),
  monthSelect: document.querySelector("#filterMonth"),
  categorySelect: document.querySelector("#categorySelect"),
  refreshBtn: document.querySelector("#refreshBtn"),
  toast: document.querySelector("#toast"),
  loadingOverlay: document.querySelector("#loadingOverlay")
};

const mockSheetRows = [
  {
    Nama: "Fajar Sodik Afendi",
    NPM: "257007111063",
    Oktober: "Rp15.000,00"
  },
  {
    Nama: "Dian Orchita Marshelia",
    NPM: "257007111090",
    Oktober: "Rp10.000,00"
  }
];

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCategory(key = state.categoryKey) {
  return categoryMap[key] || categories[0];
}

function showToast(message, type = "info") {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${type}`;
  setTimeout(() => {
    if (elements.toast) elements.toast.className = "toast";
  }, 3500);
}

function setLoading(isLoading) {
  state.loading = isLoading;
  if (!elements.loadingOverlay) return;
  elements.loadingOverlay.classList.toggle("hidden", !isLoading);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(value || 0);
}

function formatDate(value) {
  if (!value) return "-";
  if (MONTH_COLUMNS[String(value)]) return value;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(parsed);
  }
  return value;
}

function parseCurrency(value) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const sanitized = String(value)
    .replace(/Rp|\s/gi, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const parsed = Number(sanitized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function resolveTargetAmount(entry, category) {
  const candidateKeys = [
    "Target",
    "Nominal",
    "Jumlah",
    "Tarif",
    "Amount",
    "Standar",
    "target",
    "targetAmount"
  ];
  for (const key of candidateKeys) {
    if (entry[key]) {
      const parsed = parseCurrency(entry[key]);
      if (parsed > 0) return parsed;
    }
  }
  return Number(category.monthlyTarget || DEFAULT_MONTHLY_AMOUNT || 0);
}

function expandMonthlyRow(entry, category) {
  const results = [];
  const name = entry.Nama || entry.name || entry.nama || "-";
  const npm = entry.NPM || entry.npm || entry.id || "";
  const baseDescription = entry.Deskripsi || entry.description || `${category.label} bulanan`;
  const defaultTarget = resolveTargetAmount(entry, category);

  MONTH_ORDER.forEach(monthName => {
    if (!(monthName in entry)) return;
    const rawValue = entry[monthName];
    const paidAmount = parseCurrency(rawValue);
    const targetAmount = defaultTarget;
    let status = "BELUM";
    if (targetAmount > 0) {
      if (paidAmount >= targetAmount) status = "LUNAS";
      else if (paidAmount > 0) status = "CICIL";
    } else {
      status = paidAmount > 0 ? "TERCATAT" : "BELUM";
    }
    const remaining = targetAmount > 0 ? Math.max(targetAmount - paidAmount, 0) : 0;
    results.push({
      id: `${npm || name}-${monthName}-${category.key}`.replace(/\s+/g, "_"),
      name,
      npm,
      month: monthName,
      monthNumber: MONTH_COLUMNS[monthName],
      description: `${baseDescription} ${monthName}`.trim(),
      categoryKey: category.key,
      categoryLabel: category.label,
      paidAmount,
      targetAmount,
      remainingAmount: remaining,
      status,
      updatedAt: entry.updatedAt || entry.Timestamp || entry.timestamp || new Date().toISOString()
    });
  });

  return results;
}

function normalizeSimpleEntry(entry, category) {
  const paidAmount = parseCurrency(entry.amount || entry.nominal || entry.jumlah || 0);
  const targetAmount = resolveTargetAmount(entry, category);
  let status = "BELUM";
  if (targetAmount > 0) {
    if (paidAmount >= targetAmount) status = "LUNAS";
    else if (paidAmount > 0) status = "CICIL";
  } else {
    status = paidAmount > 0 ? "TERCATAT" : "BELUM";
  }
  return {
    id: entry.id || generateId(),
    name: entry.name || entry.Nama || "-",
    npm: entry.npm || entry.NPM || "",
    month: entry.month || "",
    monthNumber: entry.monthNumber || null,
    categoryKey: category.key,
    categoryLabel: category.label,
    paidAmount,
    targetAmount,
    remainingAmount: targetAmount > 0 ? Math.max(targetAmount - paidAmount, 0) : 0,
    status,
    updatedAt: entry.updatedAt || entry.lastUpdate || entry.timestamp || new Date().toISOString()
  };
}

function normalizeSheetData(rows, category) {
  const flattened = [];
  rows.forEach(entry => {
    const hasMonthlyColumns = MONTH_ORDER.some(month => month in entry);
    if (hasMonthlyColumns) {
      flattened.push(...expandMonthlyRow(entry, category));
    } else {
      flattened.push(normalizeSimpleEntry(entry, category));
    }
  });
  return flattened;
}

function calculateSummary(payments) {
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.paidAmount || 0), 0);
  const totalDue = payments.reduce((sum, p) => sum + Number(p.remainingAmount || 0), 0);
  return {
    totalPaid,
    totalDue,
    countPaid: payments.filter(p => p.status === "LUNAS").length,
    countDue: payments.filter(p => p.status !== "LUNAS").length
  };
}

function renderSummary() {
  if (!elements.summary) return;
  const { totalPaid, totalDue, countPaid, countDue } = calculateSummary(state.payments);
  const category = getCategory();
  elements.summary.innerHTML = `
    <article class="card">
      <h3>Total Masuk (${category.label})</h3>
      <p class="value">${formatCurrency(totalPaid)}</p>
      <span>${countPaid} siswa lunas</span>
    </article>
  `;
}

function filterPayments() {
  const { query, status, month } = state.filters;
  return state.payments.filter(payment => {
    const textBundle = [payment.name, payment.npm, payment.month, payment.categoryLabel]
      .map(text => (text || "").toString().toLowerCase());
    const matchQuery = !query || textBundle.some(text => text.includes(query));
    const matchStatus = status === "ALL" || payment.status === status;
    const matchMonth = month === "ALL" || payment.monthNumber === Number(month);
    return matchQuery && matchStatus && matchMonth;
  });
}

function renderTable() {
  if (!elements.tableBody || !elements.tableEmpty) return;
  const filtered = filterPayments();
  elements.tableBody.innerHTML = filtered.map(payment => `
    <tr>
      <td data-label="Nama">${payment.name}</td>
      <td data-label="NPM">${payment.npm || "-"}</td>
      <td data-label="Bulan">${payment.month || "-"}</td>
      <td data-label="Kategori">${payment.categoryLabel}</td>
      <td data-label="Dibayar">${formatCurrency(payment.paidAmount)}</td>
      <td data-label="Target">${payment.targetAmount ? formatCurrency(payment.targetAmount) : "-"}</td>
      <td data-label="Sisa">${payment.targetAmount ? formatCurrency(payment.remainingAmount) : "-"}</td>
      <td data-label="Status"><span class="badge ${badgeClass(payment.status)}">${statusLabel(payment.status)}</span></td>
      <td data-label="Terakhir">${formatDate(payment.updatedAt)}</td>
    </tr>
  `).join("");
  elements.tableEmpty.classList.toggle("hidden", filtered.length > 0);
}

function badgeClass(status) {
  if (status === "LUNAS") return "paid";
  if (status === "CICIL") return "partial";
  if (status === "TERCATAT") return "info";
  return "unpaid";
}

function statusLabel(status) {
  if (status === "LUNAS") return "Lunas";
  if (status === "CICIL") return "Cicil";
  if (status === "TERCATAT") return "Tercatat";
  return "Belum";
}

function renderActivity() {
  if (!elements.activity) return;
  const recent = [...state.payments]
    .sort((a, b) => new Date(b.updatedAt || Date.now()) - new Date(a.updatedAt || Date.now()))
    .slice(0, 6);
  elements.activity.innerHTML = recent.map(item => `
    <li>
      <div>
        <strong>${item.name}</strong>
        <p>${item.month ? `${item.month} • ${item.categoryLabel}` : item.categoryLabel}</p>
      </div>
      <span>${statusLabel(item.status)}</span>
    </li>
  `).join("");
}

function normalizeApiPayload(payload, category) {
  const rawData = Array.isArray(payload?.data) ? payload.data : payload;
  if (!Array.isArray(rawData)) {
    return state.payments.length ? state.payments : normalizeSheetData(mockSheetRows, category);
  }
  return normalizeSheetData(rawData, category);
}

async function fetchPayments() {
  const category = getCategory();
  if (!API_BASE_URL) {
    state.payments = normalizeSheetData(mockSheetRows, category);
    renderSummary();
    renderTable();
    renderActivity();
    showToast("Konfigurasi API belum diatur. Menampilkan data contoh.", "warning");
    return;
  }
  try {
    setLoading(true);
    const url = new URL(API_BASE_URL);
    url.searchParams.set("action", "list");
    url.searchParams.set("sheet", category.sheet);
    if (config.API_KEY) url.searchParams.set("apiKey", config.API_KEY);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error("Gagal memuat data");
    const payload = await response.json();
    state.payments = normalizeApiPayload(payload, category);
    renderSummary();
    renderTable();
    renderActivity();
    showToast(`Data ${category.label} diperbarui`, "success");
  } catch (error) {
    console.error(error);
    showToast("Tidak bisa terhubung ke API. Menampilkan data lokal.", "warning");
    if (state.payments.length === 0) {
      state.payments = normalizeSheetData(mockSheetRows, category);
      renderSummary();
      renderTable();
      renderActivity();
    }
  } finally {
    setLoading(false);
  }
}

async function submitPayment(formData) {
  if (!API_BASE_URL) {
    showToast("Set dulu API_BASE_URL di config.js", "warning");
    return false;
  }
  const category = getCategory();
  const payload = {
    name: formData.get("name"),
    npm: (formData.get("npm") || "").toString().trim(),
    month: formData.get("month"),
    amount: Number(formData.get("amount")),
    mode: formData.get("updateMode") || "add",
    note: formData.get("note"),
    description: formData.get("description"),
    categoryKey: category.key,
    sheet: category.sheet,
    updatedAt: new Date().toISOString()
  };
 const form = new FormData();
for (const [key, value] of Object.entries(payload)) {
  form.append(key, value);
}

const url = new URL(API_BASE_URL);
url.searchParams.set("action", "updateMonth");
url.searchParams.set("sheet", category.sheet);
if (config.API_KEY) url.searchParams.set("apiKey", config.API_KEY);

const response = await fetch(url.toString(), {
  method: "POST",
  body: form, 
});
  if (!response.ok) throw new Error((await response.text()) || "Gagal menyimpan data");
  return response.json();
}

function resetForm() {
  if (!elements.form) return;
  elements.form.reset();
  applyCategoryDefaults();
  const nameField = elements.form.querySelector("select[name='name']") || elements.form.querySelector("input[name='name']");
  if (nameField) nameField.focus();
}

function initFilters() {
  if (elements.searchInput) {
    elements.searchInput.addEventListener("input", event => {
      state.filters.query = event.target.value.trim().toLowerCase();
      renderTable();
    });
  }
  if (elements.statusSelect) {
    elements.statusSelect.addEventListener("change", event => {
      state.filters.status = event.target.value;
      renderTable();
    });
  }
  if (elements.monthSelect) {
    elements.monthSelect.addEventListener("change", event => {
      state.filters.month = event.target.value;
      renderTable();
    });
  }
}

function initForm() {
  if (!elements.form) return;
  elements.form.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(elements.form);
    try {
      setLoading(true);
      await submitPayment(formData);
      showToast("Pembayaran tersimpan", "success");
      resetForm();
      await fetchPayments();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Gagal menyimpan", "danger");
    } finally {
      setLoading(false);
    }
  });
}

function initRefresh() {
  if (!elements.refreshBtn) return;
  elements.refreshBtn.addEventListener("click", () => fetchPayments());
}

function initCategorySelect() {
  if (!elements.categorySelect) return;
  elements.categorySelect.innerHTML = categories
    .map(cat => `<option value="${cat.key}">${cat.label}</option>`)
    .join("");
  elements.categorySelect.value = state.categoryKey;
  elements.categorySelect.addEventListener("change", async event => {
    state.categoryKey = event.target.value;
    updateCategoryContext();
    applyCategoryDefaults();
    await fetchPayments();
  });
}

function applyStatusFilterOptions() {
  if (!elements.statusSelect) return;
  elements.statusSelect.innerHTML = STATUS_OPTIONS
    .map(option => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  elements.statusSelect.value = state.filters.status;
}

function updateCategoryContext() {
  const category = getCategory();
  if (elements.summarySubtitle) {
    elements.summarySubtitle.textContent = `Ringkasan ${category.label} per siswa.`;
  }
  if (elements.formSubtitle) {
    elements.formSubtitle.textContent = `Catat pembayaran ${category.label.toLowerCase()} per bulan.`;
  }
  if (elements.tableSubtitle) {
    elements.tableSubtitle.textContent = `Daftar pembayaran ${category.label}.`;
  }
  if (elements.activitySubtitle) {
    elements.activitySubtitle.textContent = `Aktivitas terbaru ${category.label}.`;
  }
}

function applyCategoryDefaults() {
  if (!elements.form) return;
  const category = getCategory();
  const amountInput = elements.form.querySelector("input[name='amount']");
  if (amountInput && (!amountInput.value || amountInput.value === "0")) {
    amountInput.value = category.monthlyTarget || DEFAULT_MONTHLY_AMOUNT || 0;
  }
  const monthSelect = elements.form.querySelector("select[name='month']");
  if (monthSelect && !monthSelect.value) {
    const currentMonth = new Date().getMonth() + 1;
    const defaultMonthName = MONTH_ORDER.find(name => MONTH_COLUMNS[name] === currentMonth);
    if (defaultMonthName && [...monthSelect.options].some(opt => opt.value === defaultMonthName)) {
      monthSelect.value = defaultMonthName;
    }
  }
  const modeSelect = elements.form.querySelector("select[name='updateMode']");
  if (modeSelect) modeSelect.value = "add";
}

function bootstrap() {
  initCategorySelect();
  applyStatusFilterOptions();
  updateCategoryContext();
  applyCategoryDefaults();
  renderSummary();
  renderTable();
  renderActivity();
  initFilters();
  initForm();
  initRefresh();
  fetchPayments();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
