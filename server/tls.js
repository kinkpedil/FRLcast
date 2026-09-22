// Self-signed TLS, so the capture node works on a second machine.
//
// Browsers only expose navigator.mediaDevices in a secure context. "localhost" counts as
// one; "http://192.168.100.101:4700" does not — over plain HTTP to a bare IP the whole
// object is simply absent, which is why the node page on a laptop fails with
// "Cannot read properties of undefined (reading 'getDisplayMedia')" while the same page
// on the server machine works. No amount of application code can work around it: the API
// is not there to call.
//
// The only fix is to serve the page over HTTPS. No public certificate authority will
// issue a certificate for a private LAN address, so we generate a self-signed one here on
// first run and list every LAN address of this machine as a subject alternative name.
// Browsers show a warning the first time; accepting it once makes the origin secure and
// mediaDevices appears.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Windows rarely has openssl on PATH, but Git for Windows ships one and is near-universal
// on a machine that has this project checked out.
const OPENSSL_CANDIDATES = [
  'openssl',
  'C:/Program Files/Git/mingw64/bin/openssl.exe',
  'C:/Program Files/Git/usr/bin/openssl.exe',
  'C:/Program Files (x86)/Git/mingw64/bin/openssl.exe',
  '/usr/bin/openssl'
];

function findOpenssl() {
  for (const exe of OPENSSL_CANDIDATES) {
    try {
      execFileSync(exe, ['version'], { stdio: 'ignore' });
      return exe;
    } catch { /* not this one */ }
  }
  return null;
}

/**
 * Key and certificate covering `addresses`, generating them if needed.
 *
 * Returns null rather than throwing when openssl is missing: HTTPS is an enhancement,
 * and losing it must not stop the plain HTTP server the panel and OBS rely on.
 */
export function ensureCert(dir, addresses = []) {
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  const sanFile = path.join(dir, 'san.txt');

  const san = ['DNS:localhost', 'IP:127.0.0.1', ...addresses.map((a) => `IP:${a}`)].join(',');

  // A certificate that does not name the address the laptop actually types is worse than
  // none: the browser rejects it outright instead of offering to continue. So the SAN list
  // is recorded alongside, and the certificate is reissued whenever the machine's
  // addresses change — a new WiFi network, a DHCP lease moving on.
  try {
    if (fs.existsSync(keyFile) && fs.existsSync(certFile) &&
        fs.existsSync(sanFile) && fs.readFileSync(sanFile, 'utf8') === san) {
      return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), reused: true };
    }
  } catch { /* fall through and regenerate */ }

  const openssl = findOpenssl();
  if (!openssl) return null;

  try {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync(openssl, [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyFile,
      '-out', certFile,
      '-days', '3650',
      '-subj', '/CN=FR Legends Broadcast',
      '-addext', `subjectAltName=${san}`
    ], { stdio: 'ignore' });
    fs.writeFileSync(sanFile, san);
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), reused: false };
  } catch {
    return null;
  }
}
