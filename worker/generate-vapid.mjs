import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1"
});

const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });

const x = Buffer.from(pub.x, "base64url");
const y = Buffer.from(pub.y, "base64url");
const rawPublic = Buffer.concat([Buffer.from([0x04]), x, y]).toString("base64url");

process.stdout.write(JSON.stringify({
  publicKey: rawPublic,
  privateKey: priv.d
}));
