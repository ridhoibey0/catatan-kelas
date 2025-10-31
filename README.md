# Catatan Pembayaran Kelas

Website statis mobile-friendly untuk mencatat pembayaran kas kelas dan pemasukan lain. Aplikasi ini dibangun dengan HTML, CSS, dan JavaScript murni sehingga dapat langsung dipublikasikan ke GitHub Pages. Data disimpan di Google Sheets melalui Web App Google Apps Script sebagai API ringan.

## Fitur
- Pilihan kategori (mis. Kas, Jahim) dengan ringkasan dan tabel yang berganti secara instan.
- Perhitungan otomatis jumlah dibayar, target bulanan, dan sisa tagihan per siswa.
- Formulir cicilan: tambahkan nominal baru atau ganti total bulan secara langsung.
- Kompatibel dengan format sheet satu baris per siswa dengan kolom bulan Januari–Desember.
- Filter pencarian berdasarkan nama, NPM, status (lunas/cicil/belum), dan bulan.
- Daftar aktivitas terbaru plus notifikasi toast dan indikator loading.

## Struktur Proyek
```
index.html
assets/
	css/styles.css
	js/app.js
	js/config.sample.js
```

File `assets/js/config.js` sudah disiapkan dengan nilai kosong; gunakan `assets/js/config.sample.js` sebagai referensi apabila ingin menyimpan contoh konfigurasi lain.

## Cara Pakai
1. Duplikasi repositori ini atau salin file ke repositori GitHub Pages Anda.
2. Jalankan langkah integrasi Google Sheets (bagian berikut).
3. Edit konfigurasi di `assets/js/config.js`.
4. Commit dan push perubahan. GitHub Pages akan menayangkan situs secara otomatis.
5. Saat mencatat transaksi pilih kategori yang tepat, isi Nama + NPM + Bulan sesuai baris pada Google Sheets, lalu pilih apakah nominal ingin ditambahkan ke saldo sebelumnya (default) atau mengganti total bulan tersebut.

## Integrasi Google Sheets
Agar situs dapat membaca dan menulis data ke Google Sheets, buat Google Apps Script sebagai API.

### 1. Siapkan Spreadsheet
1. Buat Google Sheet baru, beri nama misalnya **Keuangan Kelas**.
2. Siapkan satu tab per kategori, contoh: `Kas`, `Jahim`, `Donasi`. Masing-masing tab memiliki header baris pertama:
 	`No.`, `Nama`, `NPM`, `Januari`, `Februari`, `Maret`, `April`, `Mei`, `Juni`, `Juli`, `Agustus`, `September`, `Oktober`, `November`, `Desember`, `Terakhir` (opsional).
3. Setiap baris mewakili satu siswa. Kolom bulan diisi nilai nominal yang sudah dibayar (boleh angka murni atau format rupiah). Tambahkan kolom `Target`/`Nominal` bila ingin nominal berbeda per siswa. Kosongkan bulan apabila belum ada pembayaran.

### 2. Buat Apps Script Web App
1. Di Google Sheet, buka **Extensions → App Script**.
2. Hapus kode default, ganti dengan skrip di bawah ini:

```javascript
const DEFAULT_SHEET = 'Kas';
const MONTH_HEADERS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const API_KEY = 'ganti_dengan_api_key_optional';

function doGet(e) {
	try {
		if (!authorize(e)) return unauthorized();
		const sheetName = resolveSheetName(e?.parameter?.sheet);
		const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
		if (!sheet) throw new Error(`Sheet ${sheetName} tidak ditemukan`);
		const values = sheet.getDataRange().getDisplayValues();
		const headers = values.shift();
		const data = values.map(row => Object.fromEntries(headers.map((key, i) => [key, row[i]])));
		return jsonResponse({ data, sheet: sheetName });
	} catch (error) {
		return jsonResponse({ error: error.message });
	}
}

function doPost(e) {
	try {
		if (!authorize(e)) return unauthorized();
		const payload = e.postData?.contents ? JSON.parse(e.postData.contents) : {};
		const action = e.parameter?.action || payload.action || 'updateMonth';
		const sheetName = resolveSheetName(e.parameter?.sheet || payload.sheet);
		if (action === 'updateMonth') {
			const result = updateMonth(payload, sheetName);
			return jsonResponse(result);
		}
		return jsonResponse({ error: 'Unknown action' });
	} catch (error) {
		return jsonResponse({ error: error.message });
	}
}

function updateMonth(payload, sheetName) {
	const { name = '', npm = '', month, amount = 0, mode = 'add' } = payload;
	if (!month) throw new Error('Parameter month wajib diisi');
	if (!MONTH_HEADERS.includes(month)) throw new Error('Bulan tidak dikenal');

	const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
	if (!sheet) throw new Error(`Sheet ${sheetName} tidak ditemukan`);
	const values = sheet.getDataRange().getValues();
	const headers = values[0];

	const monthIndex = headers.indexOf(month);
	if (monthIndex === -1) throw new Error(`Kolom ${month} tidak ditemukan`);

	const nameIndex = headers.indexOf('Nama');
	const npmIndex = headers.indexOf('NPM');
	let rowNumber = -1;
	for (let i = 1; i < values.length; i++) {
		const row = values[i];
		const matchNpm = npm && row[npmIndex]?.toString().trim() === npm.trim();
		const matchName = name && row[nameIndex]?.toString().trim().toLowerCase() === name.trim().toLowerCase();
		if (matchNpm || matchName) {
			rowNumber = i + 1;
			break;
		}
	}
	if (rowNumber === -1) throw new Error('Siswa tidak ditemukan');

	const cell = sheet.getRange(rowNumber, monthIndex + 1);
	const currentValue = cell.getValue();
	const currentAmount = normaliseAmount(currentValue);
	const numericAmount = Number(amount || 0);
	const isReplace = mode === 'replace';
	let newAmount = isReplace ? numericAmount : currentAmount + numericAmount;

	if (isReplace && numericAmount <= 0) {
		cell.clearContent();
		newAmount = 0;
	} else {
		cell.setValue(newAmount);
		cell.setNumberFormat('Rp#,##0.00');
	}

	const lastIndex = headers.indexOf('Terakhir');
	if (lastIndex !== -1) {
		sheet.getRange(rowNumber, lastIndex + 1).setValue(new Date());
	}

	return {
		ok: true,
		sheet: sheetName,
		row: rowNumber,
		month,
		amount: newAmount,
		previousAmount: currentAmount,
		mode
	};
}

function normaliseAmount(value) {
	if (!value) return 0;
	if (typeof value === 'number') return value;
	const cleaned = value.toString()
		.replace(/Rp|\s/gi, '')
		.replace(/\./g, '')
		.replace(/,/g, '.');
	const parsed = Number(cleaned);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function resolveSheetName(requested) {
	return requested || DEFAULT_SHEET;
}

function authorize(e) {
	if (!API_KEY) return true;
	const incomingKey = e?.parameter?.apiKey || '';
	return incomingKey === API_KEY;
}

function unauthorized() {
	return jsonResponse({ error: 'Unauthorized' });
}

function jsonResponse(payload) {
	return ContentService
		.createTextOutput(JSON.stringify(payload))
		.setMimeType(ContentService.MimeType.JSON);
}
```

3. Simpan skrip, beri nama **kas-api**.
4. Deploy sebagai **Web App**: *Deploy → New deployment*. Pilih tipe Web app, set *Execute as Me* dan *Who has access* menjadi *Anyone* atau *Anyone with the link*.
5. Salin URL Web App yang diberikan (misal `https://script.google.com/macros/s/AKfycb.../exec`).
6. (Opsional) Isi `API_KEY` dengan string rahasia sederhana. Jika diisi, pastikan kunci yang sama juga dikonfigurasi di `config.js`.

> **Catatan:** Anda dapat mengembangkan otorisasi lebih aman dengan Google OAuth atau Cloud Functions sesuai kebutuhan.

Front-end mengirim `action=list&sheet=<nama_tab>` (GET) untuk membaca data, dan `action=updateMonth` (POST) dengan payload `{ name, npm, month, amount, mode, sheet }` untuk menambahkan atau mengganti nilai kolom bulan.

### 3. Konfigurasi Aplikasi
1. Buka `assets/js/config.js` dan isi nilai berikut:

```javascript
window.APP_CONFIG = {
	API_BASE_URL: 'https://script.google.com/macros/s/AKfycbXXXX/exec',
	API_KEY: 'opsional_sesuai_script',
	DEFAULT_MONTHLY_AMOUNT: 15000,
	DEFAULT_CATEGORY: 'kas',
	CATEGORIES: [
		{ key: 'kas', label: 'Kas Kelas', sheet: 'Kas', monthlyTarget: 15000 },
		{ key: 'jahim', label: 'Jaket Himapro', sheet: 'Jahim', monthlyTarget: 75000 }
	]
};
```

2. `DEFAULT_CATEGORY` menentukan kategori pertama yang tampil.
3. `monthlyTarget` dipakai untuk menghitung status lunas/cicil/belum dan sisa tagihan tiap bulan.
4. Commit file `config.js` **hanya jika** API key Anda aman untuk publik. Untuk kunci rahasia, simpan di repositori private atau pasang saat build.
5. Jika menggunakan `API_KEY`, app akan otomatis menambahkan parameter `apiKey` pada setiap request ke Web App.

### Mode Update di Form
- **Tambahkan ke jumlah sebelumnya** (`mode: add`) menjumlahkan nominal baru dengan saldo kolom bulan. Cocok untuk cicilan berkali-kali.
- **Ganti total bulan ini** (`mode: replace`) menimpa kolom bulan dengan nominal baru. Isi `0` untuk mengosongkan pembayaran bulan tersebut.

## Deployment ke GitHub Pages
1. Push seluruh proyek ke repositori GitHub (branch `main` atau `master`).
2. Aktifkan GitHub Pages di **Settings → Pages** dan pilih branch yang sesuai.
3. Tunggu proses build, lalu akses URL GitHub Pages Anda.

## Pengembangan Lanjutan
- Tambahkan autentikasi sederhana (misal password) sebelum menampilkan data.
- Tambahkan grafik ringkasan dengan Chart.js.
- Ekspor data ke CSV langsung dari halaman.
- Gunakan Service Worker untuk mode offline sederhana.

## Lisensi
Gunakan proyek ini untuk pembelajaran atau adaptasi internal kelas Anda. Tambahkan lisensi resmi bila ingin dipublikasikan secara luas.
