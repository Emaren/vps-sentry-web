#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"
REMOTE_APP_WORKFLOW_SCRIPT="$ROOT_DIR/scripts/vps-remote-app-workflow.sh"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

VPS_HOST="${VPS_HOST:-hetzner-codex}"
VPS_APP_DIR="${VPS_APP_DIR:-}"
VPS_SERVICE="${VPS_SERVICE:-}"
VPS_PM2_APP="${VPS_PM2_APP:-}"
VPS_LOG_LINES="${VPS_LOG_LINES:-150}"
VPS_GIT_REF="${VPS_GIT_REF:-}"
VPS_DEPLOY_STRATEGY="${VPS_DEPLOY_STRATEGY:-abort}"
VPS_REQUIRE_CLEAN_LOCAL="${VPS_REQUIRE_CLEAN_LOCAL:-1}"
VPS_REQUIRE_PUSHED_REF="${VPS_REQUIRE_PUSHED_REF:-1}"
VPS_REQUIRE_NONINTERACTIVE_SUDO="${VPS_REQUIRE_NONINTERACTIVE_SUDO:-1}"
VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"
VPS_SSH_STABILITY_PROBES="${VPS_SSH_STABILITY_PROBES:-6}"
VPS_SSH_STABILITY_INTERVAL_SECONDS="${VPS_SSH_STABILITY_INTERVAL_SECONDS:-1}"
VPS_SSH_STABILITY_MAX_FAILURES="${VPS_SSH_STABILITY_MAX_FAILURES:-0}"
VPS_SSH_STABILITY_FAIL_ON_UFW_UNKNOWN="${VPS_SSH_STABILITY_FAIL_ON_UFW_UNKNOWN:-0}"
VPS_DOCTOR_INCLUDE_SSH_STABILITY="${VPS_DOCTOR_INCLUDE_SSH_STABILITY:-1}"
VPS_DOCTOR_FAIL_ON_SSH_STABILITY="${VPS_DOCTOR_FAIL_ON_SSH_STABILITY:-1}"
VPS_DOCTOR_INCLUDE_CANARY="${VPS_DOCTOR_INCLUDE_CANARY:-1}"
VPS_DOCTOR_FAIL_ON_CANARY="${VPS_DOCTOR_FAIL_ON_CANARY:-1}"
VPS_DB_PROVIDER="${VPS_DB_PROVIDER:-sqlite}"
VPS_RUN_DB_MIGRATIONS="${VPS_RUN_DB_MIGRATIONS:-1}"
VPS_WEB_PORT="${VPS_WEB_PORT:-3035}"
VPS_DEPLOY_USE_MAINTENANCE="${VPS_DEPLOY_USE_MAINTENANCE:-1}"
VPS_DEPLOY_MAINTENANCE_TTL="${VPS_DEPLOY_MAINTENANCE_TTL:-15m}"
VPS_DEPLOY_CANARY_ENABLED="${VPS_DEPLOY_CANARY_ENABLED:-1}"
VPS_DEPLOY_CANARY_TIMEOUT_SECONDS="${VPS_DEPLOY_CANARY_TIMEOUT_SECONDS:-120}"
VPS_DEPLOY_CANARY_INTERVAL_SECONDS="${VPS_DEPLOY_CANARY_INTERVAL_SECONDS:-3}"
VPS_DEPLOY_CANARY_REQUIRED_SUCCESSES="${VPS_DEPLOY_CANARY_REQUIRED_SUCCESSES:-3}"

usage() {
  cat <<'EOF'
Usage: ./scripts/vps.sh <command> [args]

Commands:
  check                Validate SSH + app directory + optional service/pm2 target.
  doctor               Run fail-fast readiness checks for SSH/sudo/restart path.
  ssh-stability-check  Probe repeated SSH connects + guard against OpenSSH LIMIT rules.
  deploy               Pull latest code, install deps, build, then restart app target.
  restart              Restart app target (systemd or pm2).
  canary               Verify loopback app health after deploy/restart expectations.
  logs                 Tail app logs (systemd journal or pm2 logs).
  rollback [commitish] Roll back app directory to commitish (default: HEAD~1), then restart.

Config:
  Create .vps.env from .vps.example.env.

Deploy safety knobs:
  VPS_DEPLOY_STRATEGY=abort|reset
    - abort (default): fail deploy when remote branch has local-only commits.
    - reset: create backup branch on VPS, then hard-reset to origin/<target>.
  VPS_REQUIRE_CLEAN_LOCAL=1|0
    - 1 (default): require clean local git worktree before deploy.
  VPS_REQUIRE_PUSHED_REF=1|0
    - 1 (default): if VPS_GIT_REF is set, require local HEAD to exist on origin/<ref>.
  VPS_REQUIRE_NONINTERACTIVE_SUDO=1|0
    - 1 (default): fail fast if sudo would prompt (zero-interactive deploy mode).

SSH reliability knobs:
  VPS_SSH_CONNECT_TIMEOUT=10
  VPS_SSH_CONNECTION_ATTEMPTS=2
  VPS_SSH_SERVER_ALIVE_INTERVAL=15
  VPS_SSH_SERVER_ALIVE_COUNT_MAX=3
  VPS_SSH_RETRIES=4
  VPS_SSH_RETRY_DELAY_SECONDS=5
  VPS_SSH_STABILITY_PROBES=6
  VPS_SSH_STABILITY_INTERVAL_SECONDS=1
  VPS_SSH_STABILITY_MAX_FAILURES=0
  VPS_SSH_STABILITY_FAIL_ON_UFW_UNKNOWN=0
  VPS_DOCTOR_INCLUDE_SSH_STABILITY=1
  VPS_DOCTOR_FAIL_ON_SSH_STABILITY=1
  VPS_DOCTOR_INCLUDE_CANARY=1
  VPS_DOCTOR_FAIL_ON_CANARY=1

DB provider knob:
  VPS_DB_PROVIDER=sqlite|postgres
    - sqlite (default): generate Prisma client from prisma/schema.prisma
    - postgres: generate Prisma client from prisma/schema.postgres.prisma
  VPS_RUN_DB_MIGRATIONS=1|0
    - 1 (default): run `prisma migrate deploy` during VPS deploy.

Deploy verification knobs:
  VPS_DEPLOY_USE_MAINTENANCE=1|0
    - 1 (default): auto-create a temporary maintenance token around planned restarts.
  VPS_DEPLOY_MAINTENANCE_TTL=15m
    - maintenance token lifetime; should exceed build + restart time.
  VPS_DEPLOY_CANARY_ENABLED=1|0
    - 1 (default): require repeated post-restart loopback health passes before success.
  VPS_DEPLOY_CANARY_TIMEOUT_SECONDS=120
  VPS_DEPLOY_CANARY_INTERVAL_SECONDS=3
  VPS_DEPLOY_CANARY_REQUIRED_SUCCESSES=3
EOF
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "VPS_APP_DIR is not set. Add it in $ENV_FILE."
    exit 1
  fi
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "$name must be a positive integer: $value"
    exit 1
  fi
}

require_nonnegative_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 0 ]]; then
    echo "$name must be a non-negative integer: $value"
    exit 1
  fi
}

require_bool_flag() {
  local name="$1"
  local value="$2"
  if [[ "$value" != "0" && "$value" != "1" ]]; then
    echo "$name must be 0 or 1: $value"
    exit 1
  fi
}

validate_runtime_config() {
  [[ -f "$REMOTE_APP_WORKFLOW_SCRIPT" ]] || {
    echo "missing remote workflow helper: $REMOTE_APP_WORKFLOW_SCRIPT"
    exit 1
  }

  require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
  require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
  require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
  require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
  require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
  require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"
  require_positive_int "VPS_SSH_STABILITY_PROBES" "$VPS_SSH_STABILITY_PROBES"
  require_nonnegative_int "VPS_SSH_STABILITY_INTERVAL_SECONDS" "$VPS_SSH_STABILITY_INTERVAL_SECONDS"
  require_nonnegative_int "VPS_SSH_STABILITY_MAX_FAILURES" "$VPS_SSH_STABILITY_MAX_FAILURES"
  require_bool_flag "VPS_SSH_STABILITY_FAIL_ON_UFW_UNKNOWN" "$VPS_SSH_STABILITY_FAIL_ON_UFW_UNKNOWN"
  require_bool_flag "VPS_DOCTOR_INCLUDE_SSH_STABILITY" "$VPS_DOCTOR_INCLUDE_SSH_STABILITY"
  require_bool_flag "VPS_DOCTOR_FAIL_ON_SSH_STABILITY" "$VPS_DOCTOR_FAIL_ON_SSH_STABILITY"
  require_bool_flag "VPS_DOCTOR_INCLUDE_CANARY" "$VPS_DOCTOR_INCLUDE_CANARY"
  require_bool_flag "VPS_DOCTOR_FAIL_ON_CANARY" "$VPS_DOCTOR_FAIL_ON_CANARY"
  require_positive_int "VPS_WEB_PORT" "$VPS_WEB_PORT"
  require_bool_flag "VPS_DEPLOY_USE_MAINTENANCE" "$VPS_DEPLOY_USE_MAINTENANCE"
  require_bool_flag "VPS_DEPLOY_CANARY_ENABLED" "$VPS_DEPLOY_CANARY_ENABLED"
  require_positive_int "VPS_DEPLOY_CANARY_TIMEOUT_SECONDS" "$VPS_DEPLOY_CANARY_TIMEOUT_SECONDS"
  require_positive_int "VPS_DEPLOY_CANARY_INTERVAL_SECONDS" "$VPS_DEPLOY_CANARY_INTERVAL_SECONDS"
  require_positive_int "VPS_DEPLOY_CANARY_REQUIRED_SUCCESSES" "$VPS_DEPLOY_CANARY_REQUIRED_SUCCESSES"

  case "$VPS_DB_PROVIDER" in
    sqlite|postgres) ;;
    *)
      echo "VPS_DB_PROVIDER must be sqlite or postgres: $VPS_DB_PROVIDER"
      exit 1
      ;;
  esac
}

require_local_deploy_safety() {
  if [[ "$VPS_REQUIRE_CLEAN_LOCAL" == "1" ]]; then
    if ! git -C "$ROOT_DIR" diff --quiet || ! git -C "$ROOT_DIR" diff --cached --quiet; then
      echo "local_worktree_dirty: commit/stash changes before deploy, or set VPS_REQUIRE_CLEAN_LOCAL=0"
      git -C "$ROOT_DIR" status --short
      exit 1
    fi
  fi

  if [[ "$VPS_REQUIRE_PUSHED_REF" == "1" && -n "$VPS_GIT_REF" ]]; then
    if git -C "$ROOT_DIR" show-ref --verify --quiet "refs/remotes/origin/$VPS_GIT_REF"; then
      if ! git -C "$ROOT_DIR" merge-base --is-ancestor HEAD "origin/$VPS_GIT_REF"; then
        echo "local_head_not_pushed: HEAD is not on origin/$VPS_GIT_REF"
        echo "hint: push first or set VPS_REQUIRE_PUSHED_REF=0"
        exit 1
      fi
    fi
  fi
}

remote_app_workflow() {
  local action="$1"
  local rollback_target="${2:-}"

  remote \
    "VPS_APP_DIR=$(printf %q "$VPS_APP_DIR") \
VPS_SERVICE=$(printf %q "$VPS_SERVICE") \
VPS_PM2_APP=$(printf %q "$VPS_PM2_APP") \
VPS_GIT_REF=$(printf %q "$VPS_GIT_REF") \
VPS_DEPLOY_STRATEGY=$(printf %q "$VPS_DEPLOY_STRATEGY") \
VPS_REQUIRE_NONINTERACTIVE_SUDO=$(printf %q "$VPS_REQUIRE_NONINTERACTIVE_SUDO") \
VPS_DB_PROVIDER=$(printf %q "$VPS_DB_PROVIDER") \
VPS_RUN_DB_MIGRATIONS=$(printf %q "$VPS_RUN_DB_MIGRATIONS") \
VPS_WEB_PORT=$(printf %q "$VPS_WEB_PORT") \
VPS_DEPLOY_USE_MAINTENANCE=$(printf %q "$VPS_DEPLOY_USE_MAINTENANCE") \
VPS_DEPLOY_MAINTENANCE_TTL=$(printf %q "$VPS_DEPLOY_MAINTENANCE_TTL") \
VPS_DEPLOY_CANARY_ENABLED=$(printf %q "$VPS_DEPLOY_CANARY_ENABLED") \
VPS_DEPLOY_CANARY_TIMEOUT_SECONDS=$(printf %q "$VPS_DEPLOY_CANARY_TIMEOUT_SECONDS") \
VPS_DEPLOY_CANARY_INTERVAL_SECONDS=$(printf %q "$VPS_DEPLOY_CANARY_INTERVAL_SECONDS") \
VPS_DEPLOY_CANARY_REQUIRED_SUCCESSES=$(printf %q "$VPS_DEPLOY_CANARY_REQUIRED_SUCCESSES") \
VPS_ROLLBACK_TARGET=$(printf %q "$rollback_target") \
bash -s -- $(printf %q "$action")" <"$REMOTE_APP_WORKFLOW_SCRIPT"
}

remote() {
  local attempt=1
  local max_attempts="$VPS_SSH_RETRIES"
  local retry_delay="$VPS_SSH_RETRY_DELAY_SECONDS"
  local exit_code=0

  while true; do
    if ssh \
      -o BatchMode=yes \
      -o LogLevel=ERROR \
      -o ConnectTimeout="$VPS_SSH_CONNECT_TIMEOUT" \
      -o ConnectionAttempts="$VPS_SSH_CONNECTION_ATTEMPTS" \
      -o ServerAliveInterval="$VPS_SSH_SERVER_ALIVE_INTERVAL" \
      -o ServerAliveCountMax="$VPS_SSH_SERVER_ALIVE_COUNT_MAX" \
      "$VPS_HOST" "$@"; then
      return 0
    else
      exit_code=$?
    fi

    if [[ "$exit_code" -ne 255 || "$attempt" -ge "$max_attempts" ]]; then
      return "$exit_code"
    fi

    echo "ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

remote_tty() {
  local attempt=1
  local max_attempts="$VPS_SSH_RETRIES"
  local retry_delay="$VPS_SSH_RETRY_DELAY_SECONDS"
  local exit_code=0

  while true; do
    if ssh -tt \
      -o BatchMode=yes \
      -o LogLevel=ERROR \
      -o ConnectTimeout="$VPS_SSH_CONNECT_TIMEOUT" \
      -o ConnectionAttempts="$VPS_SSH_CONNECTION_ATTEMPTS" \
      -o ServerAliveInterval="$VPS_SSH_SERVER_ALIVE_INTERVAL" \
      -o ServerAliveCountMax="$VPS_SSH_SERVER_ALIVE_COUNT_MAX" \
      "$VPS_HOST" "$@"; then
      return 0
    else
      exit_code=$?
    fi

    if [[ "$exit_code" -ne 255 || "$attempt" -ge "$max_attempts" ]]; then
      return "$exit_code"
    fi

    echo "ssh_retry_tty:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

check_ssh_connectivity() {
  local err=""
  if ! err="$(remote "echo ssh_ok:\$(whoami)@\$(hostname)" 2>&1 >/dev/null)"; then
    echo "ssh_unreachable:$VPS_HOST"
    echo "hint: verify sshd is running, port 22 is open, and key auth works."
    if [[ -n "$err" ]]; then
      echo "ssh_error:$err"
    fi
    exit 50
  fi
}

check_ssh_stability() {
  local prefix="${1:-ssh_stability}"
  local probe_count="$VPS_SSH_STABILITY_PROBES"
  local probe_interval="$VPS_SSH_STABILITY_INTERVAL_SECONDS"
  local max_failures="$VPS_SSH_STABILITY_MAX_FAILURES"
  local fail_on_ufw_unknown="$VPS_SSH_STABILITY_FAIL_ON_UFW_UNKNOWN"

  echo "${prefix}_host:$VPS_HOST"
  echo "${prefix}_probes:$probe_count"
  echo "${prefix}_max_failures:$max_failures"

  local success_count=0
  local failure_count=0
  local transport_failure_count=0
  local first_error=""
  local i=1

  while [[ "$i" -le "$probe_count" ]]; do
    local err_file
    err_file="$(mktemp)"
    if ssh \
      -o BatchMode=yes \
      -o LogLevel=ERROR \
      -o ConnectTimeout="$VPS_SSH_CONNECT_TIMEOUT" \
      -o ConnectionAttempts=1 \
      -o ServerAliveInterval="$VPS_SSH_SERVER_ALIVE_INTERVAL" \
      -o ServerAliveCountMax="$VPS_SSH_SERVER_ALIVE_COUNT_MAX" \
      "$VPS_HOST" "echo ssh_probe_ok" >/dev/null 2>"$err_file"; then
      success_count=$((success_count + 1))
      echo "${prefix}_probe_${i}:ok"
    else
      local rc=$?
      local err_msg=""
      err_msg="$(tr '\r\n' ' ' <"$err_file" | sed 's/[[:space:]]\+/ /g' | sed 's/^ //; s/ $//')"
      if [[ -z "$first_error" ]]; then
        first_error="$err_msg"
      fi
      failure_count=$((failure_count + 1))
      if [[ "$err_msg" == *"Connection refused"* || "$err_msg" == *"timed out"* || "$err_msg" == *"No route to host"* || "$err_msg" == *"kex_exchange_identification"* || "$err_msg" == *"Connection closed by remote host"* ]]; then
        transport_failure_count=$((transport_failure_count + 1))
      fi
      echo "${prefix}_probe_${i}:fail rc=${rc} msg=${err_msg:-unknown}"
    fi
    rm -f "$err_file"

    if [[ "$i" -lt "$probe_count" && "$probe_interval" -gt 0 ]]; then
      sleep "$probe_interval"
    fi
    i=$((i + 1))
  done

  echo "${prefix}_success:$success_count"
  echo "${prefix}_failures:$failure_count"
  echo "${prefix}_transport_failures:$transport_failure_count"

  local ufw_state="missing"
  local ufw_limit_rule="not_applicable"
  if remote "command -v ufw >/dev/null 2>&1"; then
    local ufw_output=""
    if ufw_output="$(remote "sudo -n ufw status numbered" 2>/dev/null)"; then
      ufw_state="visible"
      ufw_limit_rule="absent"
      if printf '%s\n' "$ufw_output" | grep -Eiq 'OpenSSH.*LIMIT IN|22/tcp.*LIMIT IN'; then
        ufw_limit_rule="present"
      fi
    else
      ufw_state="hidden"
      ufw_limit_rule="unknown"
    fi
  fi

  echo "${prefix}_ufw_state:$ufw_state"
  echo "${prefix}_ufw_limit_rule:$ufw_limit_rule"

  local fail_reason=""
  if [[ "$ufw_limit_rule" == "present" ]]; then
    fail_reason="ufw_limit_rule_present"
  elif [[ "$failure_count" -gt "$max_failures" ]]; then
    fail_reason="ssh_probe_failures_exceeded_threshold"
  elif [[ "$fail_on_ufw_unknown" == "1" && "$ufw_state" == "hidden" ]]; then
    fail_reason="ufw_visibility_missing_noninteractive_sudo"
  fi

  if [[ -n "$fail_reason" ]]; then
    echo "${prefix}_status:fail"
    echo "${prefix}_reason:$fail_reason"
    if [[ -n "$first_error" ]]; then
      echo "${prefix}_first_error:$first_error"
    fi
    echo "${prefix}_hint:remove_ufw_limit_for_openssh_and_keep_allow_22_for_automation"
    return 1
  fi

  echo "${prefix}_status:pass"
  if [[ "$ufw_state" == "hidden" ]]; then
    echo "${prefix}_note:ufw_status_not_visible_without_sudo_n_for_ufw"
  fi
  return 0
}

require_noninteractive_sudo() {
  if [[ "$VPS_REQUIRE_NONINTERACTIVE_SUDO" != "1" ]]; then
    return
  fi

  if [[ -z "$VPS_SERVICE" ]]; then
    return
  fi

  local err=""
  if ! err="$(remote "sudo -n systemctl show --property=Id '$VPS_SERVICE' >/dev/null 2>&1" 2>&1 >/dev/null)"; then
    if [[ "$err" == *"Connection refused"* || "$err" == *"timed out"* || "$err" == *"No route to host"* ]]; then
      echo "ssh_unreachable:$VPS_HOST"
      echo "hint: transport failure occurred while checking non-interactive sudo."
      echo "ssh_error:$err"
      exit 50
    fi

    cat <<'EOF'
sudo_noninteractive_required: cannot run sudo -n on VPS.
This deploy flow is zero-interactive and will not wait for password prompts.
Fix options:
  1) Configure NOPASSWD sudo for service restart/status/log commands.
  2) Set VPS_REQUIRE_NONINTERACTIVE_SUDO=0 (not recommended).
See docs/vps-recovery-runbook.md.
EOF
    if [[ -n "$err" ]]; then
      echo "sudo_probe_error:$err"
    fi
    exit 51
  fi
}

cmd="${1:-}"
arg="${2:-}"

validate_runtime_config

case "$cmd" in
  check)
    require_app_dir
    remote "set -e
      echo connected:\$(whoami)@\$(hostname)
      if [ ! -d '$VPS_APP_DIR' ]; then
        echo app_dir_missing:'$VPS_APP_DIR'
        exit 1
      fi
      echo app_dir_ok:'$VPS_APP_DIR'
      cd '$VPS_APP_DIR'
      echo branch:\$(git rev-parse --abbrev-ref HEAD)
      echo commit:\$(git rev-parse --short HEAD)

      if [ -n '$VPS_SERVICE' ]; then
        if systemctl is-active '$VPS_SERVICE' >/dev/null 2>&1; then
          echo service_active:'$VPS_SERVICE'
        else
          echo service_inactive:'$VPS_SERVICE'
        fi
      fi

      if [ -n '$VPS_PM2_APP' ]; then
        if pm2 describe '$VPS_PM2_APP' >/dev/null 2>&1; then
          echo pm2_ok:'$VPS_PM2_APP'
        else
          echo pm2_missing:'$VPS_PM2_APP'
        fi
      fi"
    ;;

  doctor)
    require_app_dir
    remote "set -eu
      doctor_ok=1

      echo doctor_connected:\$(whoami)@\$(hostname)
      if [ ! -d '$VPS_APP_DIR' ]; then
        echo doctor_app_dir_missing:'$VPS_APP_DIR'
        exit 1
      fi
      if [ ! -d '$VPS_APP_DIR/.git' ]; then
        echo doctor_app_not_git:'$VPS_APP_DIR'
        exit 1
      fi
      echo doctor_app_dir_ok:'$VPS_APP_DIR'

      if [ -n '$VPS_SERVICE' ]; then
        if sudo -n systemctl show --property=Id '$VPS_SERVICE' >/dev/null 2>&1; then
          echo doctor_sudo_noninteractive:ok
        else
          echo doctor_sudo_noninteractive:missing
          if [ '$VPS_REQUIRE_NONINTERACTIVE_SUDO' = '1' ]; then
            doctor_ok=0
          fi
        fi

        if systemctl cat '$VPS_SERVICE' >/dev/null 2>&1; then
          echo doctor_service_unit_found:'$VPS_SERVICE'
        else
          echo doctor_service_unit_missing:'$VPS_SERVICE'
        fi

        if sudo -n /usr/local/bin/vps-sentry-maintenance status >/dev/null 2>&1; then
          echo doctor_maintenance_sudo:ok
        else
          echo doctor_maintenance_sudo:missing
          doctor_ok=0
        fi

        doctor_event_unit_tmp=\$(mktemp)
        if sudo -n systemctl cat 'vps-sentry-unit-event@.service' >\"\$doctor_event_unit_tmp\" 2>/dev/null; then
          if grep -q 'Description=.*%i' \"\$doctor_event_unit_tmp\" && grep -q -- '--spec %i' \"\$doctor_event_unit_tmp\"; then
            echo doctor_event_template:ok
          else
            echo doctor_event_template:legacy_or_invalid
            doctor_ok=0
          fi
        else
          echo doctor_event_template:missing
          doctor_ok=0
        fi
        rm -f \"\$doctor_event_unit_tmp\"
      fi

      if [ -n '$VPS_PM2_APP' ]; then
        if pm2 describe '$VPS_PM2_APP' >/dev/null 2>&1; then
          echo doctor_pm2_ok:'$VPS_PM2_APP'
        else
          echo doctor_pm2_missing:'$VPS_PM2_APP'
        fi
      fi

      if [ \"\$doctor_ok\" -ne 1 ]; then
        echo doctor_fail:non-interactive sudo is required but unavailable
        exit 51
      fi"

    if [[ "$VPS_DOCTOR_INCLUDE_SSH_STABILITY" == "1" ]]; then
      if ! check_ssh_stability "doctor_ssh_stability"; then
        if [[ "$VPS_DOCTOR_FAIL_ON_SSH_STABILITY" == "1" ]]; then
          echo "doctor_fail:ssh_stability_guard_failed"
          exit 52
        fi
        echo "doctor_warn:ssh_stability_guard_failed"
      fi
    else
      echo "doctor_ssh_stability:skipped"
    fi

    if [[ "$VPS_DOCTOR_INCLUDE_CANARY" == "1" ]]; then
      if remote_app_workflow canary; then
        echo "doctor_canary:pass"
      elif [[ "$VPS_DOCTOR_FAIL_ON_CANARY" == "1" ]]; then
        echo "doctor_fail:deploy_canary_guard_failed"
        exit 53
      else
        echo "doctor_warn:deploy_canary_guard_failed"
      fi
    else
      echo "doctor_canary:skipped"
    fi

    echo "doctor_pass"
    ;;

  ssh-stability-check)
    check_ssh_connectivity
    check_ssh_stability "ssh_stability"
    ;;

  deploy)
    require_app_dir
    require_local_deploy_safety
    check_ssh_connectivity
    remote_app_workflow deploy
    ;;

  restart)
    require_app_dir
    check_ssh_connectivity
    remote_app_workflow restart
    ;;

  canary)
    require_app_dir
    check_ssh_connectivity
    remote_app_workflow canary
    ;;

  logs)
    if [[ -n "$VPS_SERVICE" ]]; then
      check_ssh_connectivity
      require_noninteractive_sudo
      remote_tty "sudo -n journalctl -u '$VPS_SERVICE' -n '$VPS_LOG_LINES' -f --no-pager"
      exit 0
    fi
    if [[ -n "$VPS_PM2_APP" ]]; then
      check_ssh_connectivity
      remote_tty "pm2 logs '$VPS_PM2_APP' --lines '$VPS_LOG_LINES'"
      exit 0
    fi
    echo "No log target configured. Set VPS_SERVICE or VPS_PM2_APP in $ENV_FILE."
    exit 1
    ;;

  rollback)
    require_app_dir
    target="${arg:-HEAD~1}"
    check_ssh_connectivity
    remote_app_workflow rollback "$target"
    ;;

  ""|-h|--help|help)
    usage
    ;;

  *)
    echo "Unknown command: $cmd"
    usage
    exit 1
    ;;
esac
