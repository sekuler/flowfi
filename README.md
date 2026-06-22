# Arc Bridge — USDC Köprüleyici

Ethereum Sepolia'dan Arc Testnet'e USDC taşıyan web uygulaması.  
Circle App Kit (CCTP v2) kullanır. Tamamen testnet — gerçek para yok.

---

## Gereksinimler

- [Node.js v22+](https://nodejs.org/) (terminale `node -v` yaz, kontrol et)
- [MetaMask](https://metamask.io/) tarayıcı eklentisi
- Sepolia USDC ve Sepolia ETH (gas için)

---

## Kurulum — Adım Adım

### 1. Projeyi indir ve bağımlılıkları yükle

```bash
cd arc-bridge-app
npm install
```

### 2. Geliştirme sunucusunu başlat

```bash
npm run dev
```

Tarayıcıda şu adresi aç: **http://localhost:5173**

---

## Kullanım

### Adım 1 — Test fonları al

**Sepolia USDC:**
1. https://faucet.circle.com adresine git
2. "Ethereum Sepolia" seç
3. Cüzdan adresini gir → USDC gönderilir

**Sepolia ETH (gas için):**
- https://www.alchemy.com/faucets/ethereum-sepolia

### Adım 2 — MetaMask'a Ethereum Sepolia ekle

MetaMask genellikle Sepolia'yı otomatik bilir.  
Görmüyorsan: Ayarlar → Ağlar → Ağ Ekle → Ethereum Sepolia

### Adım 3 — Uygulamayı kullan

1. "MetaMask ile Bağlan" butonuna tıkla
2. Uygulama otomatik olarak Sepolia'ya geçirir
3. Köprülemek istediğin USDC miktarını gir
4. "Köprüle" butonuna tıkla
5. MetaMask'ta iki işlemi onayla (approve + burn)
6. Ekranda adım adım ilerlemeyi izle
7. Tamamlanınca Arc Testnet Explorer'da kontrol et

### Adım 4 — Arc Testnet'i MetaMask'a ekle (opsiyonel)

Arc Testnet'teki bakiyeni görmek için MetaMask'a elle ekleyebilirsin:

| Alan | Değer |
|------|-------|
| Ağ Adı | Arc Testnet |
| RPC URL | https://rpc.testnet.arc.network |
| Chain ID | 5042002 |
| Para Birimi | USDC |
| Explorer | https://testnet.arcscan.app |

---

## Proje Yapısı

```
arc-bridge-app/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── src/
    ├── main.tsx              ← Giriş noktası
    ├── App.tsx               ← Ana bileşen (cüzdan/köprü akışı)
    ├── chains.ts             ← Arc Testnet config ve adresler
    └── components/
        ├── WalletConnect.tsx ← Cüzdan bağlama, ağ kontrolü
        ├── BridgeForm.tsx    ← Köprüleme formu ve işlemi
        └── BridgeStatus.tsx  ← Canlı adım takibi
```

---

## Teknik Notlar

- **Gas token:** Arc Testnet'te gas ETH değil, native USDC ile ödenir
- **Native USDC:** 18 decimal (gas için)
- **ERC-20 USDC:** 6 decimal (token transferleri için)
- **Bridge protokolü:** CCTP v2 (Circle Cross-Chain Transfer Protocol)
- **Chain ID:** 5042002

---

## Önemli Linkler

| | |
|---|---|
| Arc Testnet Explorer | https://testnet.arcscan.app |
| Circle Faucet | https://faucet.circle.com |
| Arc Docs | https://docs.arc.io |
| App Kit Docs | https://docs.arc.io/app-kit |
