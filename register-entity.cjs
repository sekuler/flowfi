const crypto = require('crypto');
const fs = require('fs');
const { registerEntitySecretCiphertext } = require('@circle-fin/developer-controlled-wallets');

const apiKey = 'TEST_API_KEY:b7a157af5cf03553196f24c833133e6a:3c2e91838deab1bda37b67640e84064b';
const entitySecret = crypto.randomBytes(32).toString('hex');

console.log('ENTITY SECRET (bunu .env dosyana kaydet):', entitySecret);

registerEntitySecretCiphertext({ apiKey, entitySecret })
  .then((r) => {
    console.log('BASARILI - KAYIT TAMAMLANDI');
    if (r.data?.recoveryFile) {
      fs.writeFileSync('recovery_file.dat', r.data.recoveryFile);
      console.log('recovery_file.dat KAYDEDILDI - bu dosyayı güvenli bir yerde sakla!');
    } else {
      console.log('UYARI: recoveryFile gelmedi, response:', JSON.stringify(r.data));
    }
  })
  .catch((e) => {
    console.error('HATA:', e.message);
  });
