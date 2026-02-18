#!/bin/sh
echo "=== Dashboard Starting ==="
echo "PORT=${PORT:-3000}"
echo "Files in /usr/share/nginx/html:"
ls -la /usr/share/nginx/html/
echo "==="

# Update nginx to listen on Railway's PORT
sed -i "s/listen 3000/listen ${PORT:-3000}/" /etc/nginx/conf.d/default.conf

echo "Nginx config:"
cat /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
