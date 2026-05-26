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

# API KEYS (sourced from ~/.secrets — chmod 600, OCX-blocked)
[ -f ~/.secrets ] && . ~/.secrets
. "$HOME/.turso/env"

# Quick dictation - speaks into clipboard
alias mic="parecord -d 5 -f S16_LE -c 1 -r 16000 /tmp/dictation.wav 2>/dev/null && echo 'Recorded 5s'"
export GTK_IM_MODULE=gtk-im-context-simple
export QT_IM_MODULE=simple

. "$HOME/.cargo/env"

source <(COMPLETE=bash agentfs)
