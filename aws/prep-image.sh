#!/bin/bash
set -e
set -x
set -o pipefail

nodeversion=17.1.0

cd "/home/ubuntu"
sudo apt-get update
sudo apt-get dist-upgrade -y --no-install-recommends
sudo apt-get install -y --no-install-recommends net-tools awscli nginx jq
sudo ufw allow 'Nginx Full'
sudo systemctl enable nginx.service
sudo systemctl start nginx.service || true

cd /usr/
sudo apt-get remove -y nodejs npm
sudo wget --no-verbose https://nodejs.org/dist/v$nodeversion/node-v$nodeversion-linux-x64.tar.xz -O node.tgz
echo f0db80870a2a4da6361b2e7779d43d6b163f1a0cb80250f3a8471150a0e4dbe4 node.tgz | sha256sum --check --strict -
sudo tar xf node.tgz
sudo rm node.tgz
sudo cp -pRdf node-v$nodeversion-linux-x64/* /usr/
sudo rm -r node-v$nodeversion-linux-x64/

sudo mkdir -p /node/
cd /node/
[ -d squirrel-update ] || git clone https://github.com/observeinc/squirrel-update
cd squirrel-update
npm install --production

sudo cp aws/squirrel-update.service /etc/systemd/system/
sudo systemctl enable squirrel-update.service
sudo systemctl start squirrel-update.service
sudo cp aws/system-update.cron /etc/cron.weekly/
sudo mkdir -p /etc/letsencrypt
sudo cp aws/certbot-cli.ini /etc/letsencrypt/cli.ini

sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
[ -f /usr/bin/certbot ] || sudo ln -s /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx -n -c /etc/letsencrypt/cli.ini --domains 'cloud-instance.observe-eng.com'
cat /etc/nginx/sites-enabled/default
sudo cp aws/nginx.conf /etc/nginx/sites-enabled/default
sudo systemctl restart nginx

sudo certbot renew --dry-run -n -c /etc/letsencrypt/cli.ini

sudo wget https://vanta-agent.s3.amazonaws.com/v1.5.9/vanta.deb
sudo dpkg -i vanta.deb
sudo /var/vanta/vanta-cli register --secret "$(aws secretsmanager --region=us-west-2 get-secret-value --secret-id vanta-server-agent | jq -r .SecretString | jq -r .vanta_key)"
