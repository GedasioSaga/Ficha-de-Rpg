#!/usr/bin/env node
// Cifra segredos.local.json -> src-tauri/resources/segredos.enc
//
// O repositório é público: token do Discord e chaves Gemini só viajam
// cifrados. Este script é o lado "escrever" do cofre; o lado "ler" é
// src-tauri/src/segredos.rs — os dois falam o MESMO formato:
//   "RPGSEG1\n" (8 bytes) + salt(16) + nonce(12) + AES-256-GCM(JSON)+tag(16)
//   chave = scrypt(senha, salt, 32, N=2^15, r=8, p=1)
//
// Uso (na raiz do projeto):
//   node scripts/segredos-cifrar.mjs          # pede a senha no terminal
//   node scripts/segredos-cifrar.mjs --auto-teste   # vetor fixo p/ teste Rust
//
// segredos.local.json (gitignored, NUNCA commitar):
//   { "discord_token": "...", "gemini_api_keys": "chave1,chave2" }

import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAGIC = Buffer.from("RPGSEG1\n", "ascii");
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

function cifrar(segredos, senha, salt, nonce) {
  const chave = scryptSync(senha, salt, 32, SCRYPT);
  const cipher = createCipheriv("aes-256-gcm", chave, nonce);
  const claro = Buffer.from(JSON.stringify(segredos), "utf8");
  const cifrado = Buffer.concat([cipher.update(claro), cipher.final()]);
  return Buffer.concat([MAGIC, salt, nonce, cifrado, cipher.getAuthTag()]);
}

// Vetor determinístico pro teste cross-implementação no Rust
// (segredos.rs::tests::decifra_blob_gerado_pelo_node).
if (process.argv.includes("--auto-teste")) {
  const blob = cifrar(
    { discord_token: "tok-node", gemini_api_keys: "g1,g2" },
    "teste-cross-impl",
    Buffer.alloc(16, 0xab),
    Buffer.alloc(12, 0xcd),
  );
  console.log(blob.toString("hex"));
  process.exit(0);
}

let segredos;
try {
  segredos = JSON.parse(readFileSync(join(RAIZ, "segredos.local.json"), "utf8"));
} catch (e) {
  console.error("Não li segredos.local.json na raiz do projeto.");
  console.error('Crie com: { "discord_token": "...", "gemini_api_keys": "k1,k2" }');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const senha = await rl.question("Senha-mestra (será pedida 1x em cada máquina nova): ");
const confirma = await rl.question("Confirme a senha: ");
rl.close();

if (!senha || senha !== confirma) {
  console.error("Senhas vazias ou diferentes. Nada gravado.");
  process.exit(1);
}

const destino = join(RAIZ, "src-tauri", "resources", "segredos.enc");
writeFileSync(destino, cifrar(segredos, senha, randomBytes(16), randomBytes(12)));
console.log(`OK: ${destino}`);
console.log("Commite o segredos.enc (é cifrado, pode ir pro repo público).");
console.log("NUNCA commite o segredos.local.json.");
