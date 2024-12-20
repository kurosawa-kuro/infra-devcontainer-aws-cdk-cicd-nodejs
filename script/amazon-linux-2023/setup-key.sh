#!/bin/bash

setup_ssh_key() {
    echo -e "\n=== Setting up SSH key ==="
    
    # .sshディレクトリがない場合は作成
    if [ ! -d ~/.ssh ]; then
        mkdir -p ~/.ssh
        chmod 700 ~/.ssh
    fi

    # 既存の鍵があればバックアップ
    if [ -f ~/.ssh/id_rsa ]; then
        timestamp=$(date +%Y%m%d_%H%M%S)
        echo "Backing up existing SSH key to id_rsa.backup_${timestamp}"
        mv ~/.ssh/id_rsa ~/.ssh/id_rsa.backup_${timestamp}
    fi
    
    # 一つ上のsecretディレクトリから鍵をコピー
    if [ -f ~/secret/id_rsa ]; then
        echo "Copying SSH key from secret directory..."
        cp ~/secret/id_rsa ~/.ssh/id_rsa
        chmod 600 ~/.ssh/id_rsa
        echo "SSH key setup completed successfully."
    else
        echo "Error: SSH key not found in ~/secret/id_rsa"
        exit 1
    fi
}

# 最初にSSH鍵のセットアップを実行
setup_ssh_key

setup_git_config() {
    echo "Configuring Git settings..."
    git config --global user.name "Toshifumi Kurosawa"
    git config --global user.email "kuromailserver@gmail.com"
    
    echo "Checking Git configuration..."
    git config --list
}

test_github_connection() {
    echo "Testing GitHub connection..."
    ssh -T git@github.com
}

clear_cache() {
    echo "Clearing system cache..."
    sudo sh -c 'sync && echo 3 > /proc/sys/vm/drop_caches'
}

# メイン処理を実行
setup_ssh_key
setup_git_config
test_github_connection
clear_cache

echo "Key setup completed!"
