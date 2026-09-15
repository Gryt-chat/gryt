#!/usr/bin/env bash
# Makes the CA, the daemon cert for Astro and the Pi's client cert. Run once on Unraid from
# this directory; rotating them is in ops/deploy/rpi/README.md.
set -euo pipefail
cd "$(dirname "$0")"

SERVER_IP="${SERVER_IP:-192.168.50.168}"
DAYS=3650

if [[ -e certs/ca.key ]]; then
    echo "certs/ca.key already exists; move certs/ aside to regenerate" >&2
    exit 1
fi

umask 077
mkdir -p certs/daemon certs/client

openssl genrsa -out certs/ca.key 4096
openssl req -x509 -new -key certs/ca.key -sha256 -days "$DAYS" \
    -subj "/CN=gryt-buildkit-ca" -out certs/ca.pem

# Server
openssl genrsa -out certs/daemon/key.pem 4096
openssl req -new -key certs/daemon/key.pem -subj "/CN=gryt-buildkit" \
    -out certs/daemon/csr.pem
printf 'subjectAltName=IP:%s,DNS:astro,DNS:astro.lan\nextendedKeyUsage=serverAuth\n' \
    "$SERVER_IP" > certs/daemon/ext.cnf
openssl x509 -req -in certs/daemon/csr.pem -CA certs/ca.pem -CAkey certs/ca.key \
    -CAcreateserial -days "$DAYS" -sha256 -extfile certs/daemon/ext.cnf \
    -out certs/daemon/cert.pem
cp certs/ca.pem certs/daemon/ca.pem

# Client (the Pi)
openssl genrsa -out certs/client/key.pem 4096
openssl req -new -key certs/client/key.pem -subj "/CN=rpi" -out certs/client/csr.pem
printf 'extendedKeyUsage=clientAuth\n' > certs/client/ext.cnf
openssl x509 -req -in certs/client/csr.pem -CA certs/ca.pem -CAkey certs/ca.key \
    -CAcreateserial -days "$DAYS" -sha256 -extfile certs/client/ext.cnf \
    -out certs/client/cert.pem
cp certs/ca.pem certs/client/ca.pem

rm -f certs/daemon/csr.pem certs/daemon/ext.cnf certs/client/csr.pem certs/client/ext.cnf

# buildkitd in the rootless image runs as uid 1000.
chmod 755 certs certs/daemon
chmod 644 certs/daemon/*.pem
chown -R 1000:1000 certs/daemon

echo "done: certs/daemon for the container, certs/client for the Pi"
