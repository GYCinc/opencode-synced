# .bashrc

# Source global definitions
if [ -f /etc/bashrc ]; then
    . /etc/bashrc
fi

# User specific environment
if ! [[ "$PATH" =~ "$HOME/.local/bin:$HOME/bin:" ]]; then
    PATH="$HOME/.local/bin:$HOME/bin:$PATH"
fi
export PATH

# Uncomment the following line if you don't like systemctl's auto-paging feature:
# export SYSTEMD_PAGER=

# User specific aliases and functions
if [ -d ~/.bashrc.d ]; then
    for rc in ~/.bashrc.d/*; do
        if [ -f "$rc" ]; then
            . "$rc"
        fi
    done
fi
unset rc

# opencode
export PATH=/home/hayron/.opencode/bin:$PATH

# Zlides launcher
alias zlides='cd /home/hayron/MyProjects/zlides && ./launch.sh'

# OCX profiles
alias students='ocx opencode -p students'
alias gitenglish='cd /home/hayron/MyProjects/gitEnglishDD && ocx opencode -p gitenglish'

# API KEYS
# export ASSEMBLYAI_API_KEY='[REDACTED]'
# export GOOGLE_CALENDAR_ID='[REDACTED]'
# export CONTEXT7_API_KEY='[REDACTED]'
# export OPENROUTER_API_KEY='[REDACTED]'
# export DEEPSEEK_API_KEY='[REDACTED]'
# export HUGGING_FACE_WRITE_TOKEN='[REDACTED]'
# export MISTRAL_API_KEY='[REDACTED]'
# export TURSO_API_KEY='[REDACTED]'
# export INTERFAZE_API_KEY='[REDACTED]'
# export RAILWAY_TOKEN='[REDACTED]'
# export MORGEN_API_KEY='[REDACTED]'
# export DAYTONA_API_KEY='[REDACTED]'
# export DAYTONA_API_URL='[REDACTED]'
# export DAYTONA_SANDBOX_NAME='[REDACTED]'
# export DAYTONA_SANDBOX_UUID='[REDACTED]'
# export DAYTONA_SSH_COMMAND='[REDACTED]'
# export OPENAI_API_KEY='[REDACTED]'
# export CLOUDFLARE_ACCOUNT_ID='[REDACTED]'
# export CLOUDFLARE_API_TOKEN='[REDACTED]'
export CLOUDFLARE_NAMESPACE='MCP_SERVERS'
# export CLOUDFLARE_NAMESPACE_ID='[REDACTED]'
export D1_DATABASE_UUID='2ac52c6c-95ea-44d6-bd1c-06b4ef01c43e'
# export GEMINI_API_KEY='[REDACTED]'
# export SECRET_ICAL_URL='[REDACTED]'
# export PUBLIC_ICAL_URL='[REDACTED]'
. "$HOME/.turso/env"

# ── Preply / OBS Session ──────────────────────────────────────────
# export CAL_API_KEY='[REDACTED]'
# export DEEPGRAM_API_KEY='[REDACTED]'
# export GCAL_ICS_URL='[REDACTED]'
# export GOOGLE_CALENDAR_ID='[REDACTED]'

# Quick dictation - speaks into clipboard
alias mic="parecord -d 5 -f S16_LE -c 1 -r 16000 /tmp/dictation.wav 2>/dev/null && echo 'Recorded 5s'"
export GTK_IM_MODULE=gtk-im-context-simple
export QT_IM_MODULE=simple

. "$HOME/.cargo/env"

source <(COMPLETE=bash agentfs)
