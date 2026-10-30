FROM nginx:1.27-alpine
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV STABLE_HOST=backend-stable STABLE_PORT=3000 \
    CANARY_HOST=backend-canary CANARY_PORT=3000 \
    CANARY_PERCENT=10 CANARY_FORCE_TOKEN=cambia-este-token
EXPOSE 80
