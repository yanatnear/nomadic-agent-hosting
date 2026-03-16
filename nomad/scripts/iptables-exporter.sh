#!/usr/bin/env bash
set -euo pipefail
PORT="${1:-9199}"

serve_metrics() {
  local metrics=""
  while IFS= read -r line; do
    local chain
    chain=$(echo "$line" | awk '{print $2}')
    local drop_line
    drop_line=$(iptables -L "$chain" -v -n 2>/dev/null | grep -i "DROP" | head -1 || true)
    if [ -n "$drop_line" ]; then
      local pkts bytes
      pkts=$(echo "$drop_line" | awk '{print $1}')
      bytes=$(echo "$drop_line" | awk '{print $2}')
      local alloc_id="${chain#CRABSHACK-}"
      metrics+="crabshack_egress_drops_packets{alloc=\"${alloc_id}\"} ${pkts}\n"
      metrics+="crabshack_egress_drops_bytes{alloc=\"${alloc_id}\"} ${bytes}\n"
    fi
  done < <(iptables -L -n 2>/dev/null | grep "^Chain CRABSHACK-")

  local body
  body="# HELP crabshack_egress_drops_packets Total dropped packets per container\n"
  body+="# TYPE crabshack_egress_drops_packets counter\n"
  body+="# HELP crabshack_egress_drops_bytes Total dropped bytes per container\n"
  body+="# TYPE crabshack_egress_drops_bytes counter\n"
  body+="${metrics}"

  printf "HTTP/1.1 200 OK\r\nContent-Type: text/plain; version=0.0.4\r\nConnection: close\r\n\r\n%b" "$body"
}

echo "iptables-exporter listening on :${PORT}"
while true; do
  serve_metrics | socat - TCP-LISTEN:${PORT},reuseaddr 2>/dev/null || sleep 1
done
