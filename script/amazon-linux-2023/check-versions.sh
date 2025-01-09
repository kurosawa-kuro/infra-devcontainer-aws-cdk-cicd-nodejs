#!/bin/bash

# エラー処理の設定
set -euo pipefail
trap 'echo "Error occurred: $?" >&2' ERR

# ユーティリティ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

check_command() {
    command -v "$1" &>/dev/null
}

# バージョンチェック関数
check_component_version() {
    local command=$1
    local version_command=$2
    
    if check_command "$command"; then
        log "$command version: $($version_command)"
    else
        log "$command: Not installed"
    fi
}

# データベース関連チェック
check_postgresql() {
    if check_command psql; then
        log "PostgreSQL version: $(psql --version)"
        
        DATABASE_URL="postgresql://postgres:postgres@localhost/training_develop"
        if [ -n "${DATABASE_URL:-}" ]; then
            log "PostgreSQL tables:"
            psql "${DATABASE_URL}" -c "\dt" || log "  Unable to connect to database or list tables"
        else
            log "  DATABASE_URL not set. Skipping table listing."
        fi
    else
        log "PostgreSQL: Not installed"
    fi
}

# Go環境チェック
check_go() {
    if check_command go; then
        log "Go version: $(go version)"
        log "Go environment:"
        log "  GOROOT: ${GOROOT:-Not set}"
        log "  GOPATH: ${GOPATH:-Not set}"
    else
        log "Go: Not installed"
    fi
}

# AWS設定チェック
check_aws_configuration() {
    log "=== AWS Configuration Check ==="
    log "AWS Configuration List:"
    aws configure list
    log "AWS Identity Check:"
    aws sts get-caller-identity
}

# システム情報チェック
check_system_info() {
    log "=== System Information ==="
    check_component_version "node" "node --version"
    check_component_version "npm" "npm --version"
    check_component_version "docker" "docker --version"
    check_component_version "git" "git --version"
    check_component_version "cdk" "cdk --version"
}

# メインの実行関数
check_versions() {
    log "インストール済みのコンポーネントバージョンを確認します..."
    
    # 基本コンポーネントのチェック
    check_component_version "git" "git --version"
    check_component_version "make" "make --version | head -n1"
    check_component_version "docker" "docker --version"
    check_component_version "docker-compose" "docker-compose --version"
    check_component_version "node" "node -v"
    
    # 特別なチェックが必要なコンポーネント
    check_postgresql
    check_go
}

# スクリプトの実行
check_versions
check_aws_configuration
check_system_info