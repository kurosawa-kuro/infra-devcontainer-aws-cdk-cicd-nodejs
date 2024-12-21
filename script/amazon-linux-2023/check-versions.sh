#!/bin/bash

# エラー処理の設定
set -euo pipefail
trap 'echo "エラーが発生しました: $?" >&2' ERR

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

check_command() {
    command -v "$1" &>/dev/null
}

check_versions() {
    log "インストール済みのコンポーネントバージョンを確認します..."
    
    # Git
    if check_command git; then
        log "Git version: $(git --version)"
    else
        log "Git: Not installed"
    fi

    # Make
    if check_command make; then
        log "Make version: $(make --version | head -n1)"
    else
        log "Make: Not installed"
    fi

    # Docker
    if check_command docker; then
        log "Docker version: $(docker --version)"
    else
        log "Docker: Not installed"
    fi

    # Docker Compose
    if check_command docker-compose; then
        log "Docker Compose version: $(docker-compose --version)"
    else
        log "Docker Compose: Not installed"
    fi

    # Node.js
    if check_command node; then
        log "Node.js version: $(node -v)"
    else
        log "Node.js: Not installed"
    fi

    # PostgreSQL
    if check_command psql; then
        log "PostgreSQL version: $(psql --version)"
        
        DATABASE_URL="postgresql://postgres:postgres@localhost/training_develop"
        # データベースへの接続とテーブル一覧の表示を試みる
        if [ -n "${DATABASE_URL:-}" ]; then
            log "PostgreSQL tables:"
            psql "${DATABASE_URL}" -c "\dt" || log "  Unable to connect to database or list tables"
        else
            log "  DATABASE_URL not set. Skipping table listing."
        fi
    else
        log "PostgreSQL: Not installed"
    fi

    # Go
    if check_command go; then
        log "Go version: $(go version)"
        log "Go environment:"
        log "  GOROOT: ${GOROOT:-Not set}"
        log "  GOPATH: ${GOPATH:-Not set}"
    else
        log "Go: Not installed"
    fi
}

# メイン実行
check_versions 