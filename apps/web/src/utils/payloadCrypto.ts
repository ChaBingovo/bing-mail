export type EncryptedAuthEnvelope = {
  keyToken: string;
  clientPublicKey: JsonWebKey;
  iv: string;
  ct: string;
};

const encoder = new TextEncoder();

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Encrypts sensitive password fields using ephemeral ECDH P-256 + AES-256-GCM
 * so request payloads never carry plaintext passwords.
 */
export async function encryptAuthPayload(fields: {
  password?: string;
  oldPassword?: string;
  newPassword?: string;
}): Promise<EncryptedAuthEnvelope> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前浏览器环境不支持 Web Crypto 加密");
  }
  const res = await fetch("/api/auth/key", { method: "GET", cache: "no-store" });
  if (!res.ok) {
    throw new Error("获取加密公钥失败");
  }
  const data = (await res.json()) as { keyToken?: unknown; publicKey?: unknown };
  if (typeof data.keyToken !== "string" || !data.publicKey || typeof data.publicKey !== "object") {
    throw new Error("加密公钥格式无效");
  }

  const clientPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const serverPubKey = await crypto.subtle.importKey(
    "jwk",
    data.publicKey as JsonWebKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const clientPublicKey = (await crypto.subtle.exportKey("jwk", clientPair.publicKey)) as JsonWebKey;
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: serverPubKey }, clientPair.privateKey, 256);
  const keyMaterial = await crypto.subtle.digest("SHA-256", bits);
  const aesKey = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoder.encode(JSON.stringify(fields)));

  return {
    keyToken: data.keyToken,
    clientPublicKey: {
      kty: clientPublicKey.kty,
      crv: clientPublicKey.crv,
      x: clientPublicKey.x,
      y: clientPublicKey.y,
    },
    iv: base64UrlEncodeBytes(iv),
    ct: base64UrlEncodeBytes(new Uint8Array(ct)),
  };
}
