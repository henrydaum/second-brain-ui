#!/bin/sh
set -eu

/usr/local/bin/sandbox-api &

echo "Waiting for sandbox API..."
while ! nc -z 127.0.0.1 8080; do
  sleep 0.1
done
echo "Sandbox API ready"

cd /app

while true; do
  echo "Starting base assistant template server on 0.0.0.0:3000"
  npm run start -- --hostname 0.0.0.0 --port 3000
  echo "Base assistant template server exited; restarting in 2s"
  sleep 2
done &

wait
