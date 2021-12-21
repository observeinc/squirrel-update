#!/bin/bash
set -e
set -x
set -o pipefail

nodeversion=17.1.0

cd "/home/ubuntu"
sudo apt-get update
sudo apt-get dist-upgrade -y --no-install-recommends
sudo apt-get install -y --no-install-recommends net-tools awscli nginx
sudo ufw allow 'Nginx Full'
sudo systemctl enable nginx.service
sudo systemctl start nginx.service

cd /usr/
sudo apt-get remove -y nodejs npm
sudo wget --no-verbose https://nodejs.org/dist/v$nodeversion/node-v$nodeversion-linux-x64.tar.xz -O node.tgz
echo f0db80870a2a4da6361b2e7779d43d6b163f1a0cb80250f3a8471150a0e4dbe4 node.tgz | sha256sum --check --strict -
sudo tar xf node.tgz
sudo rm node.tgz
sudo cp -pRd node-v$nodeversion-linux-x64/* /usr/
sudo rm -r node-v$nodeversion-linux-x64/

mkdir -p /node/
cd /node/
git clone https://github.com/observeinc/squirrel-update
cd squirrel-update
npm install --production

sudo cp aws/squirrel-update.service /etc/systemd/system/
sudo systemctl enable squirrel-update.service
sudo systemctl start squirrel-update.service
sudo cp aws/system-update.cron /etc/cron.weekly/

sudo cp aws/nginx.conf /etc/nginx/sites-enabled/default
sudo systemctl restart nginx
