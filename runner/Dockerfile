FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /opt/probe
RUN npm install --save-exact --ignore-scripts --no-audit playwright@1.65.0
COPY probe.mjs /opt/probe/probe.mjs
ENV HOME=/tmp
USER pwuser
ENTRYPOINT ["node", "/opt/probe/probe.mjs"]
