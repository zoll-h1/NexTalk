FROM nginx:1.27-alpine

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/certs/cert.pem /etc/nginx/certs/cert.pem
COPY nginx/certs/key.pem  /etc/nginx/certs/key.pem
