#!/bin/bash

#=========================================
# 設定と定数
#=========================================
# インストール設定
declare -A INSTALL_FLAGS=(
    [SYSTEM_UPDATES]=false
    [DEV_TOOLS]=true
    [AWS_CLI]=false
    [ANSIBLE]=false
    [DOCKER]=true
    [NODEJS]=true
    [GO]=true
    [POSTGRESQL]=true
)

# データベース設定
declare -A DB_CONFIG=(
    [DB]=dev_db
    [USER]=postgres
    [PASSWORD]=postgres
)

# グローバル定数
readonly SWAP_SIZE="4096"
readonly DOCKER_COMPOSE_VERSION="v2.21.0"
readonly GO_VERSION="1.22.0"

# インストール情報保持用
declare -A INSTALL_INFO

#=========================================
# 基本ユーティリティ
#=========================================
set -euo pipefail
trap 'error_handler $? $LINENO $BASH_LINENO "$BASH_COMMAND" $(printf "::%s" ${FUNCNAME[@]:-})' ERR

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }
error_handler() {
    log "Error occurred in ${5} at line ${2}"
    log "Last command: ${4}"
    log "Exit code: ${1}"
}
check_command() { command -v "$1" &>/dev/null; }

#=========================================
# システム設定
#=========================================
setup_swap() {
    local swap_file="/swapfile"
    log "Setting up swap file..."
    [[ "$EUID" -ne 0 ]] && { log "Error: Root privileges required"; return 1; }

    if [[ -f "$swap_file" ]]; then
        swapoff "$swap_file" 2>/dev/null || true
        rm "$swap_file"
    fi

    dd if=/dev/zero of="$swap_file" bs=1M count="$SWAP_SIZE" status=progress
    chmod 600 "$swap_file"
    mkswap "$swap_file"
    swapon "$swap_file"
    grep -q "$swap_file" /etc/fstab || echo "$swap_file none swap sw 0 0" >> /etc/fstab
}

#=========================================
# 開発ツール
#=========================================
install_dev_tools() {
    log "Installing development tools..."
    ! dnf group list installed "Development Tools" &>/dev/null && \
        dnf groupinstall "Development Tools" -y

    local packages=("git" "make" "jq" "which" "python3-pip" "python3-devel" "libffi-devel" "openssl-devel")
    for pkg in "${packages[@]}"; do
        ! rpm -q "$pkg" &>/dev/null && dnf install -y "$pkg"
    done
}

#=========================================
# PostgreSQL
#=========================================
install_postgresql() {
    check_command psql && { log "PostgreSQL is already installed"; return 0; }

    log "Installing PostgreSQL..."
    dnf install -y postgresql15-server
    [[ ! -d "/var/lib/pgsql/data/base" ]] && {
        postgresql-setup --initdb
        configure_postgresql
    }
    systemctl enable postgresql
    systemctl start postgresql
    setup_postgresql_db
}

configure_postgresql() {
    local pg_hba_conf="/var/lib/pgsql/data/pg_hba.conf"
    local postgresql_conf="/var/lib/pgsql/data/postgresql.conf"

    sudo -u postgres bash -c "
        sed -i \"s/#listen_addresses = 'localhost'/listen_addresses = '*'/\" $postgresql_conf
        cp $pg_hba_conf ${pg_hba_conf}.bak
        sed -i 's/ident/md5/g' $pg_hba_conf
        echo 'host    all    all    0.0.0.0/0    md5' >> $pg_hba_conf
    "
    chown postgres:postgres $pg_hba_conf ${pg_hba_conf}.bak $postgresql_conf
    chmod 600 $pg_hba_conf ${pg_hba_conf}.bak $postgresql_conf
}

setup_postgresql_db() {
    cd /var/lib/pgsql
    sudo -u postgres bash -c "
        psql -c \"ALTER USER postgres WITH PASSWORD '${DB_CONFIG[PASSWORD]}';\"
        createdb ${DB_CONFIG[DB]}
    "
}

#=========================================
# Docker
#=========================================
install_docker() {
    check_command docker && { log "Docker is already installed"; return 0; }

    log "Installing Docker..."
    dnf install -y docker
    systemctl enable docker
    systemctl start docker

    if ! check_command docker-compose; then
        log "Installing Docker Compose..."
        curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
            -o /usr/local/bin/docker-compose
        chmod +x /usr/local/bin/docker-compose
    fi

    ! groups ec2-user | grep -q docker && usermod -a -G docker ec2-user

    INSTALL_INFO[DOCKER]=$(cat << EOF
Docker情報:
- Docker Version: $(docker --version)
- Docker Compose Version: $(docker-compose --version)
- Docker Service: $(systemctl is-active docker)
- Docker Socket: /var/run/docker.sock
- Docker Group: docker (ec2-user added)
- 注意: 新しいシェルを開くとdockerコマンドがsudoなしで実行可能になります
EOF
)
}

#=========================================
# NodeJS
#=========================================
install_nodejs() {
    check_command node && { log "NodeJS is already installed"; return 0; }

    log "Installing NodeJS..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
    npm install -g npm@latest
}

#=========================================
# Go
#=========================================
install_go() {
    check_command go && { log "Go is already installed"; return 0; }

    log "Installing Go language..."
    local go_archive="go${GO_VERSION}.linux-amd64.tar.gz"
    
    rm -rf /usr/local/go
    curl -LO "https://go.dev/dl/${go_archive}"
    tar -C /usr/local -xzf "${go_archive}"
    rm "${go_archive}"
    
    setup_go_environment
}

setup_go_environment() {
    # システム全体の設定
    cat > /etc/profile.d/go.sh << 'EOL'
export GOROOT=/usr/local/go
export GOPATH=$HOME/go
export PATH=$PATH:$GOROOT/bin:$GOPATH/bin
EOL
    chmod 644 /etc/profile.d/go.sh

    # ユーザー設定
    ! grep -q "GOROOT" /home/ec2-user/.bashrc && {
        cat >> /home/ec2-user/.bashrc << 'EOL'
export GOROOT=/usr/local/go
export GOPATH=$HOME/go
export PATH=$PATH:$GOROOT/bin:$GOPATH/bin
EOL
    }

    # 権限設定
    chown -R root:root /usr/local/go
    mkdir -p /home/ec2-user/go
    chown -R ec2-user:ec2-user /home/ec2-user/go
}

#=========================================
# バージョン確認
#=========================================
check_installed_versions() {
    local commands=(
        "git:${INSTALL_FLAGS[DEV_TOOLS]}"
        "make:${INSTALL_FLAGS[DEV_TOOLS]}"
        "docker:${INSTALL_FLAGS[DOCKER]}"
        "docker-compose:${INSTALL_FLAGS[DOCKER]}"
        "node:${INSTALL_FLAGS[NODEJS]}"
        "psql:${INSTALL_FLAGS[POSTGRESQL]}"
    )

    for cmd_pair in "${commands[@]}"; do
        IFS=: read -r cmd flag <<< "$cmd_pair"
        [[ "$flag" = true ]] && check_command "$cmd" && {
            case "$cmd" in
                git) log "Git version: $(git --version)" ;;
                make) log "Make version: $(make --version | head -n1)" ;;
                docker) log "Docker version: $(docker --version)" ;;
                docker-compose) log "Docker Compose version: $(docker-compose --version)" ;;
                node) log "Node version: $(node -v)" ;;
                psql) log "PostgreSQL version: $(psql --version)" ;;
            esac
        }
    done
}

#=========================================
# メイン処理
#=========================================
main() {
    log "Beginning setup..."
    setup_swap

    # コンポーネントのインストール
    [[ "${INSTALL_FLAGS[DEV_TOOLS]}" = true ]] && {
        install_dev_tools
        INSTALL_INFO[DEV_TOOLS]="開発ツール: インストール済み"
    }

    [[ "${INSTALL_FLAGS[POSTGRESQL]}" = true ]] && {
        install_postgresql
        INSTALL_INFO[POSTGRESQL]=$(cat << EOF
PostgreSQL情報:
- Database: ${DB_CONFIG[DB]}
- User: ${DB_CONFIG[USER]}
- Password: ${DB_CONFIG[PASSWORD]}
- Port: 5432
- 注意: セキュリティグループで5432ポートを開放してください
EOF
)
    }

    [[ "${INSTALL_FLAGS[DOCKER]}" = true ]] && {
        install_docker
        # install_docker関数内で既にINSTALL_INFOを設定しているため、ここでは何もしない
    }

    [[ "${INSTALL_FLAGS[NODEJS]}" = true ]] && {
        install_nodejs
        INSTALL_INFO[NODEJS]="NodeJS: インストール済み ($(node -v))"
    }

    [[ "${INSTALL_FLAGS[GO]}" = true ]] && {
        install_go
        INSTALL_INFO[GO]=$(cat << EOF
Go言語情報:
- Version: $(go version)
- GOROOT: /usr/local/go
- GOPATH: /home/ec2-user/go
- 注意: 新しいシェルを開くか、source /etc/profile.d/go.shを実行してください
EOF
)
    }

    # インストール結果の表示
    log "Installation complete. Checking versions..."
    check_installed_versions

    # 最終サマリー
    log "============================================"
    log "インストール完了サマリー"
    log "============================================"
    for key in "${!INSTALL_INFO[@]}"; do
        log "${INSTALL_INFO[$key]}"
        log "--------------------------------------------"
    done
    
    log "注意事項:"
    log "1. 各コンポーネントの詳細な設定は上記のログを確認してください"
    log "2. 必要に応じてセキュリティグループの設定を行ってください"
    log "3. 環境変数を反映するには、新しいシェルを開くか、sourceコマンドを実行してください"
}

# スクリプトの実行
main
log "Setup completed successfully" 
