import crypto from 'crypto';

export function generateWorkspaceKey() {
  return crypto.randomBytes(32).toString('base64');
}

export function encryptAES(plaintext, keyBase64) {
  const iv = crypto.randomBytes(12);
  const keyBuffer = Buffer.from(keyBase64, 'base64');
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

export function decryptAES(ciphertextBase64, keyBase64) {
  const data = Buffer.from(ciphertextBase64, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(12, data.length - 16);
  const keyBuffer = Buffer.from(keyBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function base64UrlEncode(value) {
  return Buffer.from(value, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function base64UrlDecode(value) {
  let padded = value.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return Buffer.from(padded, 'base64').toString('utf-8');
}

export function xorEncrypt(data, keyText) {
  const key = Buffer.from(keyText, 'utf-8');
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const output = Buffer.alloc(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = input[index] ^ key[index % key.length];
  }
  return output;
}

export function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

export function generateX25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });
  return {
    privateKeyDer: privateKey,
    publicKeyBase64: publicKey.subarray(publicKey.length - 32).toString('base64')
  };
}

export function deriveSharedSecret(privateKeyDer, peerPublicKeyBase64) {
  const peerRaw = Buffer.from(peerPublicKeyBase64, 'base64');
  const spkiPrefix = Buffer.from('302a300506032b656e032100', 'hex');
  const peerKey = crypto.createPublicKey({ key: Buffer.concat([spkiPrefix, peerRaw]), format: 'der', type: 'spki' });
  const privateKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  return crypto.diffieHellman({ privateKey, publicKey: peerKey });
}

export function deriveAesKey(sharedSecret, info = 'IrisAuth-ECDH-v1') {
  // Keep HKDF parameters aligned with existing loaders for wire compatibility.
  return crypto.hkdfSync('sha256', sharedSecret, Buffer.from('IrisAuth-Salt', 'utf-8'), Buffer.from(info, 'utf-8'), 32);
}

export function encryptWithAesGcmBytes(data, keyBytes) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyBytes), iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(data, 'utf-8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}
