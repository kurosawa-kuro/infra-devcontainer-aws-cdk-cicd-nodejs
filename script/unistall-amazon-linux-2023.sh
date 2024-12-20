#!/bin/bash

# エラー処理の設定
set -euo pipefail
trap 'error_handler $? $LINENO $BASH_LINENO "$BASH_COMMAND" $(printf "::%s" ${FUNCNAME[@]:-})' ERR

# ユーティリティ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error_handler() {
    local exit_code=$1
    local line_no=$2
    local bash_lineno=$3
    local last_command=$4
    local func_trace=$5
    log "Error occurred in ${func_trace} at line ${line_no}"
    log "Last command: ${last_command}"
    log "Exit code: ${exit_code}"
}

# PostgreSQLのアンインストール
uninstall_postgresql() {
    log "PostgreSQLをアンインストールしています..."
    
    # サービスの停止
    systemctl stop postgresql || true
    systemctl disable postgresql || true

    # パッケージの削除
    dnf remove -y postgresql15\* || true

    # データディレクトリの削除
    rm -rf /var/lib/pgsql
    rm -rf /var/log/postgresql
    rm -rf /etc/postgresql

    # ユーザーとグループの削除
    userdel -r postgres || true
    groupdel postgres || true

    log "PostgreSQLのアンインストール��完了しました"
}

# Dockerのアンインストール
uninstall_docker() {
    log "Dockerをアンインストールしています..."
    
    # サービスの停止
    systemctl stop docker || true
    systemctl disable docker || true

    # Docker Composeの削除
    rm -f /usr/local/bin/docker-compose

    # Dockerパッケージの削除
    dnf remove -y docker docker-* || true

    # Dockerデータの削除
    rm -rf /var/lib/docker
    rm -rf /etc/docker

    log "Dockerのアンインストールが完了しました"
}

# NodeJSのアンインストール
uninstall_nodejs() {
    log "NodeJSをアンインストールしています..."
    
    # グローバルパッケージの削除
    if command -v npm &>/dev/null; then
        npm uninstall -g $(npm list -g --depth=0 | awk '/─/ {print $2}' | cut -d@ -f1)
    fi

    # NodeJSパッケージの削除
    dnf remove -y nodejs || true
    
    # NodeSourceリポジトリの削除
    rm -f /etc/yum.repos.d/nodesource*.repo

    log "NodeJSのアンインストールが完了しました"
}

# Go言語のアンインストール
uninstall_go() {
    log "Go言語をアンインストールしています..."
    
    # Goのインストールディレクトリの削除
    rm -rf /usr/local/go

    # 環境変数設定��削除
    rm -f /etc/profile.d/go.sh
    
    # ユーザー設定の削除
    sed -i '/GOROOT/d' /home/ec2-user/.bashrc
    sed -i '/GOPATH/d' /home/ec2-user/.bashrc
    
    # Goのワークスペースの削除
    rm -rf /home/ec2-user/go

    log "Go言語のアンインストールが完了しました"
}

# 開発ツールのアンインストール
uninstall_dev_tools() {
    log "開発ツールをアンインストールしています..."
    
    # Development Toolsグループの削除
    dnf groupremove -y "Development Tools" || true

    # 個別パッケージの削除
    local packages=("git" "make" "jq" "which" "python3-pip" "python3-devel" "libffi-devel" "openssl-devel")
    for pkg in "${packages[@]}"; do
        dnf remove -y "$pkg" || true
    done

    log "開発ツールのアンインストールが完了しました"
}

# Swapの削除
remove_swap() {
    log "Swapファイルを削除しています..."
    
    if [ -f "/swapfile" ]; then
        swapoff /swapfile || true
        sed -i '/swapfile/d' /etc/fstab
        rm -f /swapfile
    fi

    log "Swapファイルの削除が完了しました"
}

# メイン実行関数
main() {
    log "アンインストールを開始します..."

    # 確認プロンプト
    read -p "全ての���ンポーネントをアンインストールします。続行しますか？ (y/N): " confirm
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
        log "アンインストールを中止しました"
        exit 0
    fi

    uninstall_postgresql
    uninstall_docker
    uninstall_nodejs
    uninstall_go
    uninstall_dev_tools
    remove_swap

    # キャッシュのクリーンアップ
    dnf clean all

    log "アンインストール完了しました"
    log "全てのコンポーネントが削除されました"
}

# スクリプトの実行
main 
