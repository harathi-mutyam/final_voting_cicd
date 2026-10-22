# Voting App — Complete CI/CD, EKS, Monitoring and Cleanup Guide

> **Source:** Reformatted from the supplied deployment notes. Commands and configurations are retained as written; verify versions, access rules and placeholders before execution.

## Architecture Diagram

The following image is displayed automatically on GitHub when `architecture.excalidraw.png` is stored alongside `README.md`:

![Voting App CI/CD architecture](./architecture.excalidraw.png)

<!-- For any additional screenshots stored in images/, use:
![Screenshot description](./images/actual-filename.png)
Replace actual-filename.png with a real image filename before enabling the tag.
-->

## Step 1 — Create a Security Group
security group name: **githubaction_sg**

Inbound Security Group Rules

The following six inbound rules are configured in AWS.

| No. | Type | Protocol | Port Range | Source / CIDR | Purpose |
| --- | --- | --- | --- | --- | --- |
| 1 | SMTPS | TCP | 465 | 0.0.0.0/0 | Secure SMTP traffic |
| 2 | Custom TCP | TCP | 3000–11000 | MyIP | Access to development and monitoring services |
| 3 | HTTP | TCP | 80 | 0.0.0.0/0 | Public HTTP access |
| 4 | HTTPS | TCP | 443 | 0.0.0.0/0 | Public HTTPS access |
| 5 | SSH | TCP | 22 | My IP | Secure SSH access to EC2 |
| 6 | Custom TCP | TCP | 587 | MyIP | SMTP submission traffic |

## Step 2 — Create Two Ec2 insatnces

Operating system: Ubuntu 24.04

AWS Region: eu-north-1

| Configuration | voting-runner | voting-server |
| --- | --- | --- |
| Instance type | m7i-flex.large | t3.small |
| Operating system | Ubuntu 24.04 | Ubuntu 24.04 |
| Storage | 50 GiB gp3 | 30 GiB gp3 |
| Key pair | voting_key.pem | voting_key.pem |
| Security group | githubaction_sg | githubaction_sg |
| Purpose | GitHub Actions, Docker, SonarQube, Trivy | Terraform, AWS CLI, kubectl, Helm |

## Step 3 — Installation Part in Runner

Connect to voting-runner open gitbash terminal

```bash
ssh -i ~/Downloads/voting_key.pem ubuntu@<RUNNER_PUBLIC_IP>
sudo hostnamectl set-hostname voting-runner
exec bash
```

Update and install prerequisites:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y \
  git curl wget unzip jq gnupg \
  ca-certificates python3 python3-pip python3-venv

git --version
python3 --version
```

If your runner uses Python 3.12, install the version-specific package as well:

```bash
sudo apt install -y python3.12-venv
```

**Verify:**
```bash
python3 --version
python3 -m venv /tmp/voting-venv-test
```

Activate:
```bash
source /tmp/voting-venv-test/bin/activate
```

Check:
```bash
python -m pip --version
```

Then deactivate and clean up:
```bash
deactivate
```

```bash
rm -rf /tmp/voting-venv-test
```

#### Install Docker on Runner EC2
```bash
sudo install -m 0755 -d /etc/apt/keyrings
```

```bash
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
```

```bash
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

Add the Docker repository:
```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

Install Docker:
```bash
sudo apt update
sudo apt install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
```

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and reconnect to activate Docker group membership:
```bash
exit
exit
```

Reconnect from Windows Git Bash:
```bash
ssh -i ~/Downloads/voting-key.pem ubuntu@<RUNNER_PUBLIC_IP>
```

**Verify:**
```bash
docker --version
docker compose version
docker ps
docker run --rm hello-world
```

#### Configure SonarQube requirements
**WHERE: RUNNER EC2**
```bash
echo "vm.max_map_count=524288" | sudo tee /etc/sysctl.d/99-sonarqube.conf
```

```bash
echo "fs.file-max=131072" | sudo tee -a /etc/sysctl.d/99-sonarqube.conf
```

```bash
sudo sysctl --system
```

**Verify:**
```bash
sysctl vm.max_map_count
sysctl fs.file-max
```

#### Install SonarQube on the same Runner EC2
In  RUNNER EC2 gitbash terminal

Create persistent Docker volumes:

```bash
docker volume create sonarqube_data
docker volume create sonarqube_extensions
docker volume create sonarqube_logs
```

Start SonarQube:

```bash
docker run -d \
  --name sonarqube \
  --restart unless-stopped \
  -p 9000:9000 \
  -v sonarqube_data:/opt/sonarqube/data \
  -v sonarqube_extensions:/opt/sonarqube/extensions \
  -v sonarqube_logs:/opt/sonarqube/logs \
  sonarqube:lts-community
```

Check the container:

```bash
docker ps
```

Wait for SonarQube to initialize, then test:
```bash
curl http://localhost:9000/api/system/status
```

Expected response contains:
```bash
{"status":"UP"}
```

**Open SonarQube in your Windows browser:**
http://<RUNNER_PUBLIC_IP>:9000

Complete the initial login with username: admin password: admin and password-change to admin123 process.

Clone the updated Voting App repository
```bash
git clone https://github.com/harathi-mutyam/final_voting_cicd.git
cd final_voting_cicd
```

#### Install Python for vote
```bash
cd ~/final_voting_cicd
python3 -m venv .venv-vote
```

```bash
source .venv-vote/bin/activate
```

```bash
python -m pip install -r vote/requirements.txt
```

```bash
python -m compileall -q vote
# Exit virtual environment
deactivate
```

#### Install Node.js for Result
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x \
  | sudo -E bash -
```

```bash
sudo apt install -y nodejs
```

```bash
node --version
npm –version
```

#### Install .NET 7 SDK for worker purpose

Download Microsoft's .NET installer for worker node

```bash
cd ~
curl -fSL \
  https://dot.net/v1/dotnet-install.sh \
  -o dotnet-install.sh
```

**Install .NET 7 SDK**
```bash
bash dotnet-install.sh \
  --version 7.0.410 \
  --install-dir "$HOME/.dotnet"
```

This installs the .NET 7 SDK in /home/ubuntu/.dotnet without changing system-managed packages.

The archived SDK download must still be available for this command to succeed.

#### Configure environment variables
```bash
cat >> ~/.bashrc <<'EOF'
```

```bash
# .NET 7 SDK
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$DOTNET_ROOT:$PATH"
EOF
```

Reload the shell:
```bash
source ~/.bashrc
```

#### Verify installation
```bash
dotnet --version
dotnet --list-sdks
dotnet --list-runtimes
```

Expected SDK version:7.0.410

### Install Trivy

Trivy scans Docker images for known vulnerabilities.

```bash
sudo apt install -y wget gnupg
```

```bash
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key \
  | gpg --dearmor \
  | sudo tee /usr/share/keyrings/trivy.gpg > /dev/null
```

```bash
echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" \
  | sudo tee /etc/apt/sources.list.d/trivy.list
```

```bash
sudo apt update
sudo apt install -y trivy
trivy --version
```

## Step 4 — Connect to the Voting App server (for Management)

**Open new Another Git Bash terminal**
```bash
ssh -i ~/Downloads/voting_key.pem ubuntu@<SERVER_PUBLIC_IP>
sudo hostnamectl set-hostname voting-server
exec bash
```

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y \
  curl wget unzip git jq \
  ca-certificates gnupg lsb-release
```

**Verify:**
```bash
git --version
curl --version
```

### Install AWS CLI in server gitbash terminal

On the voting-server EC2:

```bash
cd /tmp
```

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" \
  -o "awscliv2.zip"
```

```bash
unzip -q awscliv2.zip
```

```bash
sudo ./aws/install --update
```

**Verify:**
```bash
aws --version
aws configure
```

**provide access key ,secret key,region : eu-north-1 ,json**
```bash
cd ..
```

### Install Terraform in server gitbash terminal

Add HashiCorp's package repository:

```bash
wget -O- https://apt.releases.hashicorp.com/gpg \
  | sudo gpg --dearmor \
      -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update
sudo apt install terraform -y
```

**Verify:**
```bash
terraform version
```

### Install kubectl in server gitbash terminal
```bash
cd /tmp
```

```bash
K8S_VERSION=$(curl -L -s \
  https://dl.k8s.io/release/stable.txt)
```

```bash
curl -LO \
  "https://dl.k8s.io/release/${K8S_VERSION}/bin/linux/amd64/kubectl"
```

```bash
curl -LO \
  "https://dl.k8s.io/release/${K8S_VERSION}/bin/linux/amd64/kubectl.sha256"
```

```bash
echo "$(cat kubectl.sha256)  kubectl" \
  | sha256sum --check
```

```bash
sudo install -o root -g root -m 0755 \
  kubectl /usr/local/bin/kubectl
```

**Verify:**
```bash
kubectl version --client
```

For an existing EKS cluster, the kubectl client should be within one minor version of the Kubernetes API server. We will verify that before deploying.
#### Install Helm
```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \
  | bash
```

**Verify:**
```bash
helm version
```

Helm will be used to install Argo CD, Prometheus, Grafana, Loki, Alloy and the AWS Load Balancer Controller.

**Clone the project:**
```bash
cd ~
git clone https://github.com/harathi-mutyam/final_voting_cicd.git
```

## Step 5 — Register your self-hosted GitHub Actions runner

**WHERE: voting-runner EC2**

**Open in browser:**

GitHub → final_voting_cicd → Actions Runners

Select New self-hosted runner → Linux → x64.

Copy the installation commands displayed by GitHub Download and Configure related commands upto ./config.sh command . During registration, use:

Setting	Value

| Enter the name of the runner group | press Enter key |
| --- | --- |
| Runner name	| Press  voting-runner |
| --- | --- |
| Additional label | voting-runner |
| --- | --- |
| Work directory _work |  press Enter key |


After registration, inside the runner installation directory:
```bash
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

Verify in GitHub that the runner is Idle. Or not in browser.Refresh it
The CI/CD workflow will use: runs-on: [self-hosted, linux, x64, voting-runner]

## Step 6 — Configure GitHub secrets and variables

**Open your repository's Settings → Secrets and variables → Actions.**
| Type | Name | Value |
| --- | --- | --- |
| Variable | DOCKERHUB_USERNAME | harathi2026 |
| Variable | SONAR_HOST_URL | http://localhost:9000 |
| Secret | DOCKERHUB_TOKEN | Docker Hub write-access token |
| Secret | SONAR_TOKEN | SonarQube project analysis token |

localhost:9000 is appropriate for a SonarScanner process running directly on your runner EC2, because SonarQube is on the same machine. If the scanner executes inside a separate container, use an address reachable from that container.

#### Steps for creation of DockerHub Personal Access Token (PAT) write-access-token

Open Docker Hub-->Sign in using Docker Hub Account login credentials -->click on Profile icon in the upper right corner-->open Account settings-->select Personal Access Tokens-->Generate new Token-->Enter Project name and Discription as voting-app-github-actions -->choose Read & Write Permissions (So github Actions can push Docker images)-->expiration period : 30 -->generate -->Copy the token immediately and store it securely**
#### Steps for creation of SonarQube Personal Access Token
Select manually-->Provide project name and key as voting-app-cicd-->click on generate Token-->provide name as voting-app-cicd_token -->save or copy the token value -->Place it in a safe place

Confirm that your three Docker Hub repositories exist:
| • | harathi2026/voting-vote |
| --- | --- |
| • | harathi2026/voting-result |
| • | harathi2026/voting-worker |

Yellow color highlighted content here optional only for verification 

They can be public for this demo so that EKS can pull images without an image-pull secret.

**Optional:**
```bash
cd ~/final_voting_cicd
docker login -u harathi2026


Pull all three images

docker images  #if you are get all images then pull it using below commands
docker pull harathi2026/voting-vote:latest
docker pull harathi2026/voting-result:latest



docker pull harathi2026/voting-worker:latest



docker images
```

**optional: yellow color If you are not find the images in docker hub push the images using these commands in runner gitbash terminal**
```bash
cd ~/final_voting_cicd
docker login -u harathi2026
docker login -u harathi2026
# Vote – Python



docker build -t harathi2026/voting-vote:latest ./vote



# Result - Node.js



docker build -t harathi2026/voting-result:latest ./result



# Worker - .NET



docker build -t harathi2026/voting-worker:latest ./worker



docker images
trivy image --exit-code 0 --severity HIGH,CRITICAL --ignore-unfixed harathi2026/voting-vote:latest



trivy image --exit-code 0 --severity HIGH,CRITICAL --ignore-unfixed harathi2026/voting-result:latest



trivy image --exit-code 0 --severity HIGH,CRITICAL --ignore-unfixed harathi2026/voting-worker:latest


# Push all three images to Docker Hub

docker push harathi2026/voting-vote:latest



docker push harathi2026/voting-result:latest



docker push harathi2026/voting-worker:latest

```

## Step 7 — Complete ci.yml with Trivy and GitOps

**Open runner gitbash terminal**
```bash
cd ~/final_voting_cicd
cat .github/workflows/ci.yml
if you have any changes push changes from ec2 gitbash to github
git status
git add .github/workflows/ci.yml
git commit -m "Add Voting App CI CD with Trivy and GitOps"
git push origin main
```

**open your project github in browser-->actions-->runner-->observe workflow is running.If not running Select your workflow and use Run workflow if workflow_dispatch is enabled.**

## Step 8 — Infrastructure creation

**Open server gitbash Terminal**
```bash
aws configure
```

provide access keys , secret keys , region: eu-north-1, output: json
```bash
cd ~
git clone https://github.com/harathi-mutyam/final_voting_cicd.git
cd ~/final_voting_cicd
cd terraform
terraform init
terraform fmt
```

```bash
terraform validate
```

Edit terraform.tfvars
```bash
cd ~/final_voting_cicd/terraform
```

vim terraform.tfvars

Update:
```bash
aws_region         = "eu-north-1"
cluster_name       = "voting-cluster"
kubernetes_version = "1.34"
node_instance_type , node_desired_size, node_min_size, node_max_size according to  your requirement
```
Push changes from EC2 to Github repository
```bash
cd ~/final_voting_cicd
git status
git pull origin main
git config --global user.email ehmutyam@gmail.com
git config --global user.name harathi-mutyam
git add -f terraform/terraform.tfvars
git commit -m "Update EKS node group instance type and scaling configuration"
git push origin main
git status
```

admin_cidr         = "16.171.144.221/32"   #Replace with your public ip of server ec2 instance

change AWS region, Kubernetes version and admin_cidr settings according to your setup

Initialize Terraform:
```bash
cd terraform
terraform init
terraform validate
```

**Expected:Success! The configuration is valid.**
Check existing clusters:
```bash
aws eks list-clusters --region eu-north-1
```

output must be empty
Create Terraform Plan
```bash
terraform plan -out=tfplan
```

Review:
```bash
terraform show tfplan
```

Verify the AWS resources Terraform intends to create.

Verify Kubernetes Version Availability
```bash
aws eks describe-cluster-versions \
  --region eu-north-1 \
  --query 'clusterVersions[].{Version:clusterVersion,Status:status}' \
  --output table
```

Verify that Kubernetes version 1.34 is supported before applying Terraform.
Check AWS EC2 vCPU Quota
```bash
aws service-quotas get-service-quota \
  --service-code ec2 \
  --quota-code L-1216C47A \
  --region eu-north-1 \
  --query 'Quota.Value'
```

This checks the standard On-Demand EC2 vCPU quota.

```bash
terraform apply tfplan
aws eks update-kubeconfig \
  --region eu-north-1 \
  --name voting-cluster
```

```bash
kubectl config current-context
```

Verify Worker Nodes Ready or not
```bash
kubectl get nodes -o wide
kubectl get pods -A
```

Verify EKS Node Group ACTIVE or not
```bash
aws eks describe-nodegroup \
  --cluster-name voting-cluster \
  --nodegroup-name voting-node-group \
  --region eu-north-1 \
  --query 'nodegroup.{Status:status,Scaling:scalingConfig,Health:health.issues}' \
  --output json
```

Verify EKS Add-ons
```bash
aws eks list-addons \
  --cluster-name voting-cluster \
  --region eu-north-1
```

Check Whether the Voting App Is Already Deployed
Before installing Argo CD, verify the current Kubernetes environment.
Run:
```bash
kubectl get namespaces
kubectl get pods -A
kubectl get deployments -A
kubectl get svc -A
```

Actual observation before Argo CD installation:
Only the default Kubernetes namespaces existed:
Default

## Step 9 — Install Argo CD in voting server gitbash terminal

```bash
cd ~/final_voting_cicd
kubectl create namespace argocd \
  --dry-run=client -o yaml | kubectl apply -f –
```

```bash
kubectl get namespaces
```

Download the Argo CD installation manifest
```bash
curl -fL \
  https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.6/manifests/install.yaml \
  -o /tmp/argocd-install.yaml
```

Verify Argo CD's Kubernetes resources.
```bash
ls -lh /tmp/argocd-install.yaml
```

Install the required CRDs first . Download the version-matched ApplicationSet CRD:
```bash
curl -fL \
  https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.6/manifests/crds/applicationset-crd.yaml \
  -o /tmp/applicationset-crd.yaml
# Install the ApplicationSet CRD:
kubectl apply --server-side \
  -f /tmp/applicationset-crd.yaml
```

#Wait for Kubernetes to register it:
```bash
kubectl wait \
  --for=condition=Established \
  crd/applicationsets.argoproj.io \
  --timeout=120s
```

The ApplicationSet Controller cannot operate without its CRD. Installing it before the controller starts prevents the missing-ApplicationSet error encountered during our original installation.
Install Argo CD
```bash
kubectl apply --server-side \
  -n argocd \
  -f /tmp/argocd-install.yaml
```

```bash
kubectl rollout status \
  deployment/argocd-server \
  -n argocd \
  --timeout=300s
```

```bash
kubectl get crds | grep argoproj.io
```

Expected CRD names: applications.argoproj.io ,applicationsets.argoproj.io ,appprojects.argoproj.io
If a CRD is missing, investigate before deploying applications.
```bash
kubectl get pods -n argocd
kubectl get deployments,statefulsets -n argocd
```

Check resource allocation
```bash
kubectl describe nodes | grep -A 8 "Allocated resources:"
kubectl get pods -n argocd
```

For trouble shootingCheck logs
```bash
kubectl logs -n argocd \
  deployment/argocd-applicationset-controller \
  --tail=30
```

Get initial admin password for ArgoCD
```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d
echo
```

Copy it and save it
Access Argo CD Using Port Forwarding
**Open one more new gitbash terminal**
Connect to the voting-server EC2 instance using its public IP address through ssh command
```bash
sudo hostnamectl set-hostname argocd-port-forward
exec bash
```

For demo purpose give address as 0.0.0.0
```bash
kubectl port-forward svc/argocd-server \
  -n argocd \
  8080:443 \
  --address=0.0.0.0
```

Forwarding from 0.0.0.0:8080 -> 8080
**Open argocd dashboard in browser**
http://your_server_ec2_publicip:8080

In Real time:
```bash
kubectl port-forward svc/argocd-server \
  -n argocd \
  8080:443 \
  --address=127.0.0.1
```

**Open one more new gitbash terminal**
```bash
ssh -i ~/Downloads/voting_key.pem \
  -L 8080:127.0.0.1:8080 \
  ubuntu@YOUR_server_EC2_PUBLIC_IP
```

**Open the Argo CD dashboard in Browser**
https://localhost:8080
Provide login details as
Username : admin
password:Saved password from secret

## Step 11 — Create voting namespace and Create PostgreSQL Secret

```bash
kubectl create namespace voting \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl get namespace voting
grep -R -n -A 5 'secretKeyRef:' k8s/
```

If postgres-auth does not already exist, create it:

```bash
read -rsp "Enter PostgreSQL password: " DB_PASSWORD
echo
```

```bash
kubectl create secret generic postgres-auth \
  -n voting \
  --from-literal=password="$DB_PASSWORD"
```

```bash
unset DB_PASSWORD
```

**Verify:**
```bash
kubectl get secret postgres-auth -n voting
```

## Step 12 — Install Gateway API CRDs

**open server gitbash terminal with hostname voting-server**
```bash
cd final_voting_cicd
```

Gateway API extends Kubernetes with resources such as GatewayClass, Gateway and HTTPRoute.
Install the standard Gateway API CRDs required by NGINX Gateway Fabric v2.8.0:
```bash
kubectl kustomize \
  'https://github.com/nginx/nginx-gateway-fabric/config/crd/gateway-api/standard?ref=v2.8.0' \
  | kubectl apply -f -
```

**Verify:**
```bash
kubectl get crds | grep gateway.networking.k8s.io
```

Wait for the Gateway CRD:
```bash
kubectl wait \
  --for=condition=Established \
  crd/gateways.gateway.networking.k8s.io \
  --timeout=120s
```

Wait for HTTPRoute:
```bash
kubectl wait \
  --for=condition=Established \
  crd/httproutes.gateway.networking.k8s.io \
  --timeout=120s
```

Do not proceed if these CRDs are missing.
Install NGINX Gateway Fabric in voting-server EC2 terminal
NGINX Gateway Fabric is the Gateway API controller responsible for routing external HTTP traffic to the Kubernetes Services.
Install using Helm
```bash
helm install ngf \
  oci://ghcr.io/nginx/charts/nginx-gateway-fabric \
  --version 2.8.0 \
  --create-namespace \
  -n nginx-gateway \
  --wait \
  --timeout 10m
```

Verify Helm release
```bash
helm list -n nginx-gateway
```

Expected release name: ngf
Verify Pods
```bash
kubectl get pods -n nginx-gateway
```

Wait for controller availability:
```bash
kubectl rollout status \
  deployment/ngf-nginx-gateway-fabric \
  -n nginx-gateway \
  --timeout=300s
```

```bash
kubectl get gatewayclass  # Verify GatewayClass
```

Expected GatewayClass: nginx
Its acceptance status should be True.
The NGINX Gateway controller itself does not require a public LoadBalancer Service. The Gateway's data plane will receive the public LoadBalancer when the Gateway resource is reconciled.

## Step 13 — Deploy Voting App using Argo CD

```bash
cd ~/final_voting_cicd
kubectl apply -f argocd/voting-app.yaml -n argocd
```

Verify Application
**open Argocd in browser and refresh it.**

In server gitbash terminal
```bash
kubectl get application voting-app -n argocd
```

```bash
kubectl get pods -n voting
```

```bash
kubectl get secret postgres-auth -n voting
```

```bash
kubectl get pvc -n voting
```

```bash
kubectl get gateway,httproute -n voting
```

```bash
kubectl get httproute -n voting
```

```bash
kubectl get storageclass
```

```bash
kubectl get pods -n kube-system | grep ebs-csi
```

```bash
kubectl get gateway,httproute -n voting
```

NAME             CLASS   ADDRESS                                                                    PROGRAMMED   AGE
voting-gateway   nginx   a395a070b451c45c7bfd21f928418c1d-1245277792.eu-north-1.elb.amazonaws.com   True         19m

copy the DNS address

## Step 14 — Test Voting App through Gateway in browser

Vote application
http://paste dns address
ex: http:// a395a070b451c45c7bfd21f928418c1d-1245277792.eu-north-1.elb.amazonaws.com
Result application: open one more tab
http://paste dns address/result
example:
http:// a395a070b451c45c7bfd21f928418c1d-1245277792.eu-north-1.elb.amazonaws.com/result

Troubleshooting — Voting App Not Loading in Browser
If the Vote or Result application does not load in the browser, verify the Kubernetes Gateway and HTTPRoute configurations.
```bash
kubectl describe gateway voting-gateway -n voting
```

```bash
kubectl describe httproute vote-route -n voting
```

```bash
kubectl describe httproute result-route -n voting
```

Check that both routes report Accepted=True and ResolvedRefs=True.
```bash
kubectl logs -n voting deployment/worker --tail=50
```

Optional for demo Purpose before start monitoring part run below commands
Verify resources before installing monitoring in voting-server EC2 gitbash terminal
```bash
cd ~/final_voting_cicd
kubectl get nodes -o wide
kubectl top nodes
```

```bash
kubectl top pods -A
```

If kubectl top reports Metrics API not available, check whether Metrics Server is installed:
```bash
kubectl get deployment metrics-server -n kube-system
```

Also check available resources on your two worker nodes:
```bash
kubectl describe nodes | grep -A 8 "Allocated resources:"
```

current configuration uses two c7i-flex.large nodes. Since Prometheus, Grafana, Alertmanager and Loki require additional resources, we should use a lightweight configuration for this demo.
Monitoring Part

## Step 15 — Install Prometheus, Grafana and Alertmanager

Here we use official community kube-prometheus-stack Helm chart, which includes Prometheus, Grafana, Alertmanager, Prometheus Operator, kube-state-metrics and Node Exporter
```bash
kubectl create namespace monitoring \
  --dry-run=client -o yaml | kubectl apply -f -
```

Add Prometheus Helm repository
```bash
helm repo add prometheus-community \
  https://prometheus-community.github.io/helm-charts
```

```bash
helm repo update
# Verify that the chart is available:
helm search repo prometheus-community/kube-prometheus-stack
```

```bash
cat monitoring/prometheus-values.yaml
if file exits continue below procedure
helm template monitoring \
  prometheus-community/kube-prometheus-stack \
  -n monitoring \
  -f monitoring/prometheus-values.yaml \
  > /tmp/voting-monitoring-rendered.yaml
```

If the command completes without errors, the chart has rendered successfully
Install the monitoring stack
```bash
helm upgrade --install monitoring \
  prometheus-community/kube-prometheus-stack \
  -n monitoring \
  -f monitoring/prometheus-values.yaml \
  --wait \
  --timeout 15m
```

**Verify:**
```bash
kubectl get pods -n monitoring
kubectl get svc -n monitoring
helm list -n monitoring
kubectl top nodes
```

error: Metrics API not available

Check whether Metrics Server is installed
```bash
kubectl get deployment metrics-server -n kube-system
```

Check the Metrics API:
```bash
kubectl get apiservice v1beta1.metrics.k8s.io
```

Check EKS Metrics Server add-on
```bash
aws eks describe-addon \
  --cluster-name voting-cluster \
  --addon-name metrics-server \
  --region eu-north-1
```

Output: ResourceNotFoundException
Install Metrics Server
```bash
aws eks create-addon --cluster-name voting-cluster \
  --addon-name metrics-server --region eu-north-1
```

```bash
aws eks wait addon-active --cluster-name voting-cluster \
  --addon-name metrics-server --region eu-north-1
```

Verify Metrics Server
```bash
kubectl get deployment metrics-server -n kube-system
```

Check the API:
```bash
kubectl get apiservice v1beta1.metrics.k8s.io
```

Expected API status:
v1beta1.metrics.k8s.io   kube-system/metrics-server      True
```bash
kubectl top nodes
kubectl top pods -n voting
kubectl top pods -n monitoring
```

## Step 16 — Access Grafana

**Open one new gitbash terminal : login using server ec2 publicip**
```bash
sudo hostnamectl set-hostname grafana-port-forward
exec bash
kubectl port-forward \
  -n monitoring \
  svc/monitoring-grafana \
  3000:80 --address=0.0.0.0
```

Forwarding from 0.0.0.0:3000 -> 3000
**Open browser:**
http://server_ec2_public_ip:3000
username : admin
here we required password for grafana
**open server gitbashterminal Retrieve the Grafana admin password**
```bash
kubectl get secret monitoring-grafana \
  -n monitoring \
  -o jsonpath='{.data.admin-password}' | base64 -d
```

Echo
Copy the password paste it in browser
After login into Grafana Verify Prometheus data source
**Open Connections → Data sources-->Select the existing Prometheus data source-->Verify that the URL points to your monitoring Prometheus service -->Click Save & test. Or Test -->click Test again**
Expected result: The Prometheus data source is working.
Test metrics
**Open Explore, select Prometheus -->select code(on Right side) -->type: up-->run symbol (refresh Symbol on Top with blue colour):**
A value of 1 indicates that Prometheus successfully scraped that target.
Next, check your Voting App Pods:
kube_pod_status_phase{namespace="voting",phase="Running"}
For Pods currently in the Running phase, the corresponding series should have a value of 1.
Verify Kubernetes Dashboards
In Grafana browser Navigate to Dashboards → Browse.
Look for the dashboard:
Kubernetes / Compute Resources / Namespace (Pods)
**Open it and select:**
| • | Data source: Prometheus |
| --- | --- |
| • | Namespace: voting |

You should be able to inspect CPU and memory usage for the Voting App Pods.

## Step 17 — Verify Alertmanager

**open voting-server EC2 gitbash terminal**
```bash
kubectl get alertmanager -n monitoring
kubectl get prometheusrules -n monitoring
kubectl get pods -n monitoring   # Verify that the Alertmanager Pod is still running
```

**open new gitbash terminal login using server ec2 gitbash terminal**
```bash
ssh -i ~/Downloads/voting_key.pem ubuntu@<server_ec2_PUBLIC_IP>
sudo hostnamectl set-hostname alertmanager-port-forward
exec bash
kubectl port-forward -n monitoring \
  svc/monitoring-kube-prometheus-alertmanager \
  9093:9093 --address=0.0.0.0
```

Forwarding from 0.0.0.0:9093 -> 9093
**Open browser access alertmanager with this ip**
http://server_public_ec2_ip:9093

Use an SSH tunnel for port 9093 if accessing it from your Windows computer, then open http://localhost:9093. Or http://server_public_ec2_ip:9093
Check the Alerts and Silences sections. Installing Alertmanager does not automatically configure email notifications.

## Step 18 — Check Cluster Capacity Before Loki

**Open server gitbash terminal**
```bash
kubectl top nodes
kubectl top pods -n monitoring
kubectl top pods -n voting
```

Also check available memory and CPU allocations:
```bash
kubectl describe nodes | grep -A 8 "Allocated resources:"
```

Notes for reference
| Metric | Node 1 | Node 2 |
| --- | --- | --- |
| CPU utilization | 5% | 6% |
| Memory utilization | 50% | 78% |
| CPU requests | 35% | 46% |
| Memory requests | 31% | 47% |
| Memory limits | 110% | 167% |

Interpretation: CPU capacity is sufficient at the moment. Memory is the main constraint, particularly on Node 2.
Memory limits above 100% indicate overcommitment, not necessarily a problem by themselves. However, if multiple containers approach their limits simultaneously, you could experience memory pressure or OOMKilled containers.
2. Monitoring Pod analysis
Your monitoring stack is using approximately:
| Component | Memory |
| --- | --- |
| Grafana | 444 MiB |
| Prometheus | 348 MiB |
| Alertmanager | 23 MiB |
| Prometheus Operator | 21 MiB |
| kube-state-metrics | 18 MiB |
| Node Exporter (both Pods) | 22 MiB |
| Total | 876 MiB |

Grafana is using 444 MiB against its configured 512 MiB limit, leaving only about 68 MiB of headroom. This is worth monitoring because dashboards and queries can increase memory usage.
Prometheus is using 348 MiB against its 1 GiB limit, which is currently acceptable.
3. Recommendation before Loki installation
I do not recommend installing Loki immediately with the default Helm chart values.
For your two-node c7i-flex.large cluster, use a deliberately lightweight Loki configuration. Even then, you should first inspect available allocatable resources and verify whether Grafana is approaching its memory limit.

Check resource pressure before installing loki because here I am using c7i-flex.Lrage for nodes
**Open server gitbash terminal**
```bash
kubectl get nodes -o wide
kubectl describe nodes | grep -E \
  'Name:|MemoryPressure|DiskPressure|PIDPressure'
kubectl get nodes \
  -o custom-columns=NAME:.metadata.name,ALLOCATABLE_MEMORY:.status.allocatable.memory,ALLOCATABLE_CPU:.status.allocatable.cpu
```

```bash
kubectl get pods -A \
  -o jsonpath='{range .items[*]}{.metadata.namespace}{" / "}{.metadata.name}{" / "}{range .status.containerStatuses[*]}{.name}{": "}{.lastState.terminated.reason}{" "}{end}{"\n"}{end}' \
  | grep OOMKilled
```

Here I am using an Amazon S3 bucket instead of filesystem storage for Loki

## Step 19 — Configure Amazon S3 Storage for Loki

**Open server ec2 gitbahs terminal**
```bash
cd ~/final_voting_cicd
export AWS_REGION=eu-north-1
export CLUSTER_NAME=voting-cluster
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account: $ACCOUNT_ID"
echo "Cluster: $CLUSTER_NAME"
echo "Region: $AWS_REGION"
```

Create two S3 buckets
Grafana recommends separate buckets for Loki chunks and ruler data. An admin bucket is not required for open-source Loki.
```bash
export LOKI_CHUNKS_BUCKET="voting-loki-chunks-${ACCOUNT_ID}-${AWS_REGION}"
export LOKI_RULER_BUCKET="voting-loki-ruler-${ACCOUNT_ID}-${AWS_REGION}"
```

Create the buckets:
```bash
aws s3api create-bucket \
  --bucket "$LOKI_CHUNKS_BUCKET" \
  --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"
```

```bash
aws s3api create-bucket \
  --bucket "$LOKI_RULER_BUCKET" \
  --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"
```

If either bucket already exists in your account, verify its region and reuse it rather than recreating it.
Block public access:
```bash
for BUCKET in "$LOKI_CHUNKS_BUCKET" "$LOKI_RULER_BUCKET"; do
  aws s3api put-public-access-block \
    --bucket "$BUCKET" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

```bash
  aws s3api put-bucket-encryption \
    --bucket "$BUCKET" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
done
```

**verify:**
```bash
aws s3 ls | grep voting-loki
```

Create a dedicated IAM policy
Do not put AWS access keys inside loki-values.yaml. We will grant Loki access to only the two S3 buckets using an IAM role.
Create the IAM policy document:
```bash
cat > /tmp/voting-loki-s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": [
        "arn:aws:s3:::${LOKI_CHUNKS_BUCKET}",
        "arn:aws:s3:::${LOKI_RULER_BUCKET}"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::${LOKI_CHUNKS_BUCKET}/*",
        "arn:aws:s3:::${LOKI_RULER_BUCKET}/*"
      ]
    }
  ]
}
EOF
```

Create the IAM policy:
```bash
aws iam create-policy \
  --policy-name VotingLokiS3Policy \
  --policy-document file:///tmp/voting-loki-s3-policy.json
```

Configure IAM authentication for Loki
For EKS, IRSA allows a Kubernetes ServiceAccount to assume a dedicated IAM role through the cluster's OIDC identity provider. This avoids static credentials in Helm values
First check whether the OIDC provider is associated with your cluster
```bash
aws eks describe-cluster \
  --name "$CLUSTER_NAME" \
  --region "$AWS_REGION" \
  --query 'cluster.identity.oidc.issuer' \
  --output text
```

```bash
eksctl version
```

here we will get error eksctl not installed
Install eksctl and configure Loki IAM access
**Open server gitbash terminal Install eksctl**
```bash
ARCH=amd64
PLATFORM=Linux_$ARCH
curl -sLO \
  "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_${PLATFORM}.tar.gz"
```

```bash
tar -xzf eksctl_${PLATFORM}.tar.gz
sudo install -m 0755 eksctl /usr/local/bin/eksctl
```

```bash
rm -f eksctl "eksctl_${PLATFORM}.tar.gz"
eksctl version   #we will get eksctl version number.
```

Create logging namespace
```bash
kubectl create namespace logging \
  --dry-run=client -o yaml | kubectl apply -f -
```

Create the IAM ServiceAccount:
```bash
eksctl create iamserviceaccount \
  --cluster "$CLUSTER_NAME" \
  --region "$AWS_REGION" \
  --namespace logging \
  --name loki \
  --role-name VotingLokiS3Role \
  --attach-policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/VotingLokiS3Policy" \
  --approve
```

If the OIDC provider has not been associated, associate it first:
```bash
eksctl utils associate-iam-oidc-provider \
  --cluster "$CLUSTER_NAME" --region "$AWS_REGION" \
  --approve
```

Then rerun the IAM ServiceAccount creation command.
**Verify:**
```bash
kubectl get serviceaccount loki -n logging -o yaml
```

You should see an annotation similar to:
eks.amazonaws.com/role-arn: arn:aws:iam::<ACCOUNT_ID>:role/VotingLokiS3Role
The Helm configuration will reuse this ServiceAccount rather than create a new one.

## Step 20 — Configure Loki Helm Values for S3

Add Grafana community Helm repository
The Loki chart is now maintained in the Grafana community Helm repository
```bash
helm repo add grafana-community \
  https://grafana-community.github.io/helm-charts
helm repo update
helm search repo grafana-community/loki --versions | head
aws s3 ls
```

copy the bucket values .Replace the two bucket placeholders with your actual bucket names.so open
vim nano logging/loki-values.yaml
replace chunks bucket name , ruler bucket name in loki-values.yaml file and save it
Validate the Loki configuration
Because Helm chart options change between releases, validate the selected chart before installing.
```bash
helm show values grafana-community/loki \
  > /tmp/loki-default-values.yaml
```

Render the deployment:
```bash
helm template loki grafana-community/loki \
  --version 19.0.3 \
  -n logging \
  -f logging/loki-values.yaml \
  > /tmp/voting-loki-rendered.yaml
```

If the command completes without errors, Helm successfully rendered the Kubernetes manifests. It does not yet prove Loki can access S3.

## Step 21 — Loki installation and readiness

```bash
kubectl top nodes
kubectl get pods -A
```

If sufficient capacity remains, install:
```bash
helm upgrade --install loki  grafana-community/loki \
  --version 19.0.3  -n logging \
  -f logging/loki-values.yaml \
  --wait   --timeout 15m
```

**Verify:**
```bash
kubectl get pods -n logging
kubectl get pvc -n logging
kubectl get svc -n logging
helm list -n logging
```

**Open new gitbash terminal login with server ec2 publicip**
```bash
sudo hostnamectl set-hostname loki-port-forward
exec bash
```

Check Loki's readiness endpoint using the service name shown by kubectl get svc:
```bash
kubectl port-forward -n logging \
  svc/loki-gateway 3100:3100
```

Forwarding from 0.0.0.0:3100 -> 3100

**Open oldvoting-server gitbash terminal:**
ubuntu@voting-server:~/final_voting_cicd$
```bash
cd final_voting_cicd
curl http://localhost:3100/ready
```

A healthy Loki instance should return ready.

## Step 22 — Connect Loki to Existing Grafana

**WHERE: Grafana browser**
| 1. | Open Connections → Data sources. |
| --- | --- |
| 2. | Select Add new data source. |
| 3. | Choose Loki. |
| 4. | Enter the internal Loki service URL, for example |

http://loki-gateway.logging.svc.cluster.local/
5.	Click Save & test.
This configures Grafana to query Loki, but logs will not appear until Grafana Alloy is installed and configured to collect Kubernetes container logs.
Grafana Alloy will be the next installation step.

## Step 23 — Verify S3 Storage

**Open server gitbash terminal**
```bash
echo "$LOKI_CHUNKS_BUCKET"
echo "$LOKI_RULER_BUCKET"
```

After Alloy begins forwarding logs, check that Loki is writing objects into S3:
```bash
aws s3 ls "s3://${LOKI_CHUNKS_BUCKET}/" --recursive --summarize
```

You can also inspect the ruler bucket:
```bash
aws s3 ls "s3://${LOKI_RULER_BUCKET}/" --recursive
```

The ruler bucket may remain empty until you configure Loki recording or alerting rules.
Confirm log ingestion in Grafana
**Open Grafana and navigate to:**
Explore → Loki datasource-->select code
Run this LogQL query:
```bash
{namespace="voting"}
```

It returns nothing because alloy not yet installed
**Open server gitbash terminal**
```bash
kubectl get pods -n logging -o wide
kubectl get pods -A | grep -i alloy
helm list -A
```

## Step 24 — check the Configuration of loki-values.yaml

After verifying the installation:
```bash
cd ~/final_voting_cicd
cat logging/loki-values.yaml
```

optional command if you change any thing in logging/loki-values.yaml
then only push it
```bash
git status
git add logging/loki-values.yaml
git commit -m "add: configure Loki S3 storage for voting app logs"
git push origin main
```

## Step 25 — Install Grafana Alloy

Before installation Run these  commands
```bash
cd ~/final_voting_cicd
kubectl get daemonsets -A
kubectl get deployments -A | grep -i alloy
kubectl top nodes
# Add Grafana repository
helm repo add grafana \
  https://grafana.github.io/helm-charts
helm repo update
# Check committed configuration
cat logging/alloy-values.yaml
# Render Helm manifests
helm template alloy grafana/alloy \
  --version 1.14.1 \
  -n logging \
  -f logging/alloy-values.yaml \
  > /tmp/voting-alloy-rendered.yaml
```

If the command finishes without errors, the Helm templates have rendered successfully.
# Verify DaemonSet
```bash
grep -A 3 'kind: DaemonSet' \
  /tmp/voting-alloy-rendered.yaml
```

# Verify node-name environment variable
```bash
grep -A 6 'name: K8S_NODE_NAME' \
  /tmp/voting-alloy-rendered.yaml
```

```bash
# Install Alloy
helm upgrade --install alloy grafana/alloy \
  --version 1.14.1 \
  -n logging \
  -f logging/alloy-values.yaml \
  --wait \
  --timeout 10m
# Verify installation
kubectl get daemonsets -n logging
kubectl get pods -n logging
helm list -n logging
kubectl top pods -n logging
kubectl top nodes
```

Total Alloy memory usage: 87 MiB across both worker nodes.
Optional command Check Alloy runtime logs
```bash
kubectl logs -n logging \
  -l app.kubernetes.io/name=alloy \
  -c alloy \
  --tail=50 \
  --max-log-requests=5
```

Check for errors such as permission denied, connection refused, failed to send batch, or configuration parsing failures.
```bash
kubectl get svc -n logging
```

Confirm that loki-gateway exists and exposes port 80.

## Step 26 — Verify Grafana logs

Generate Voting App activity
Access your Voting App using its existing Gateway URL  run the below command in server gitbash terminal
```bash
kubectl get gateway -n voting
```

copy the dns address check it in browser
vote: http://dnsaddress
result: http://dnsadress/result
and cast a few test votes. This generates application traffic, although actual log output depends on whether the application logs those requests.
Check logs in Grafana browser
**Open Grafana-->connections-->Datasources-->Add new data source-->search loki-->**
Connection:  URL: http://loki-gateway.logging.svc.cluster.local/
Provide or select this url-->save and test
**Open Grafana → Explore, select your existing Loki data source,select code and set the time range to Last 30 minutes.**
Run:type:{namespace="voting"}  -->click on Run query
To check individual services:
```bash
{namespace="voting",container="vote"}
```

```bash
{namespace="voting",container="result"}
```

```bash
{namespace="voting",container="worker"}
```

Click on Data Sources-->select loki-->Build a Dashboard
Click on + symbol  -->Tile: loki_application_logs
Description: Vote, Worker and Result application logs
Select Configure Visulisation-->select All Visualizations(search logs)-->select Datasource : loki-->provide query as
```bash
{namespace="voting"}
```

-->Click on Run query-->save -->Provide Title: Voting App - Centralized Logging -->Save it
Again Select Configure Visulisation-->select All Visualizations(search logs)-->select Datasource : loki-->provide query as
```bash
{namespace="voting",container="result"}
```

-->Click on Run query-->save -->Message : enter discrptionas result logs-->save

Repeat same procedure for Prometheus and alert manager also
| Panel | Visualization | Unit | Query |
| --- | --- | --- | --- |
| Prometheus Targets UP | Stat | None | sum(up == 1) |
| EKS Worker Nodes Ready | Stat | None | sum(kube_node_status_condition{condition="Ready",status="true"} == 1) |
| Voting App Running Pods | Stat | None | sum(kube_pod_status_phase{namespace="voting",phase="Running"} == 1) |
| Voting App CPU Usage | Time series | CPU cores | CPU usage query |
| Voting App Memory Usage | Time series | Bytes (IEC) | Memory usage query |
| Voting App Pod Restarts | Bar gauge | None | Restart count query |

## Step 26 — Verify Grafana Logs and S3 Persistence

```bash
export AWS_REGION=eu-north-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

```bash
export LOKI_CHUNKS_BUCKET="voting-loki-chunks-${ACCOUNT_ID}-${AWS_REGION}"
export LOKI_RULER_BUCKET="voting-loki-ruler-${ACCOUNT_ID}-${AWS_REGION}"
aws s3 ls | grep voting-loki
aws s3 ls "s3://${LOKI_CHUNKS_BUCKET}/" --recursive --summarize
aws s3 ls "s3://${LOKI_RULER_BUCKET}/" --recursive --summarize
```

**Open aws console in browser-->open s3 -->observe buckets created -->on chunks bucket logs saved**

## Appendix — Complete AWS Deletion Commands

Project: final_voting_cicd Region: eu-north-1 Cluster: voting-cluster
Run Steps 1–10 on voting-server. Run Step 11 on voting-runner. Complete the remaining steps from AWS CloudShell.
**Warning: These commands permanently delete project infrastructure and data. Verify that each resource belongs to the Voting App before deleting it.**

## Step 1 — Verify AWS Account

```bash
aws sts get-caller-identity
```

```bash
aws eks list-clusters --region eu-north-1
```

## Step 2 — Delete Argo CD Application

```bash
kubectl -n argocd patch application voting-app \
  --type merge \
  -p '{"spec":{"syncPolicy":{"automated":null}}}'
kubectl -n argocd patch application voting-app \
  --type merge \
  -p '{"metadata":{"finalizers":["resources-finalizer.argocd.argoproj.io"]}}'
kubectl delete application voting-app \
  -n argocd \
  --wait=true \
  --timeout=300s
kubectl get applications -n argocd
```

## Step 3 — Delete Voting Application Namespace

```bash
kubectl get pvc -n voting
```

```bash
kubectl delete namespace voting \
  --wait=true \
  --timeout=600s
```

```bash
kubectl get pv
```

Ensure application PVCs and PVs are removed before proceeding.

## Step 4 — Delete Loki and Alloy

```bash
helm list -n logging
helm uninstall alloy -n logging
```

```bash
helm uninstall loki -n logging
kubectl get pvc -n logging
```

If storage-loki-0 remains:
```bash
kubectl delete pvc storage-loki-0 \
  -n logging \
  --wait=false
```

Verify storage deletion:
```bash
kubectl get pvc -n logging
```

```bash
kubectl get pv
```

When Loki storage is removed:
```bash
kubectl delete namespace logging \
  --wait=true \
  --timeout=600s
```

## Step 5 — Delete Prometheus, Grafana and Alertmanager

```bash
helm list -n monitoring
```

```bash
helm uninstall monitoring -n monitoring
kubectl get pvc -n monitoring
```

```bash
kubectl get pv
```

If monitoring PVCs remain, verify their ownership and delete them:
```bash
kubectl delete pvc --all \
  -n monitoring \
  --wait=true \
  --timeout=600s
kubectl delete namespace monitoring \
  --wait=true \
  --timeout=600s
```

## Step 6 — Delete NGINX Gateway Fabric

First remove any remaining Gateway API resources belonging to the Voting App and confirm that their load balancers are being released.
```bash
kubectl get gateway -A
```

```bash
kubectl get svc -A
```

Then uninstall the controller:
```bash
helm uninstall ngf -n nginx-gateway
kubectl delete namespace nginx-gateway \
  --wait=true \
  --timeout=600s
```

Verify AWS Load Balancers:
```bash
aws elbv2 describe-load-balancers \
  --region eu-north-1 \
  --query 'LoadBalancers[].LoadBalancerName' \
  --output table
```

Do not proceed while a project load balancer remains.

## Step 7 — Delete Argo CD

```bash
kubectl get applications -n argocd
```

After confirming no applications remain:
```bash
kubectl delete namespace argocd \
  --wait=true \
  --timeout=600s
kubectl get pods -A
```

## Step 8 — Delete Loki CloudFormation Stack

```bash
STACK="eksctl-voting-cluster-addon-iamserviceaccount-logging-loki"
aws cloudformation update-termination-protection \
  --stack-name "$STACK" \
  --no-enable-termination-protection \
  --region eu-north-1
aws cloudformation delete-stack \
  --stack-name "$STACK" \
  --region eu-north-1
aws cloudformation wait stack-delete-complete \
  --stack-name "$STACK" \
  --region eu-north-1
```

Skip this step if the stack was already deleted.

## Step 9 — Delete Remaining Loki IAM Policy

```bash
ACCOUNT_ID=$(aws sts get-caller-identity \
  --query Account --output text)
```

```bash
POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/VotingLokiS3Policy"
aws iam get-role \
  --role-name VotingLokiS3Role
```

```bash
aws iam get-policy \
  --policy-arn "$POLICY_ARN"
```

If the policy still exists:
```bash
aws iam list-entities-for-policy \
  --policy-arn "$POLICY_ARN"
```

If no entities are attached and the policy belongs only to this project:
```bash
aws iam delete-policy \
  --policy-arn "$POLICY_ARN"
```

If the role still exists, inspect and remove its remaining attachments and dependencies before deleting it.

## Step 10 — Terraform Destroy

```bash
cd ~/final_voting_cicd/terraform
terraform init
```

```bash
terraform state list
terraform plan -destroy -out=destroy.tfplan
```

Review the destruction plan:
```bash
terraform show destroy.tfplan
```

After verifying that only Voting App infrastructure will be deleted:
```bash
terraform apply destroy.tfplan
```

**Verify:**
```bash
terraform state list
aws eks list-clusters \
  --region eu-north-1
```

**Expected: No managed Terraform resources and no voting-cluster.**

## Step 11 — Remove GitHub Actions Runner

**WHERE: voting-runner EC2 terminal**
```bash
cd ~/actions-runner
```

If the runner was installed as a service:
```bash
sudo ./svc.sh stop
```

```bash
sudo ./svc.sh uninstall
```

Remove GitHub registration:
```bash
./config.sh remove
```

Provide a GitHub runner removal token if requested.

## Step 12 — Delete Loki S3 Buckets

**WHERE: AWS CloudShell**
```bash
ACCOUNT_ID=$(aws sts get-caller-identity \
  --query Account --output text)
```

```bash
CHUNKS_BUCKET="voting-loki-chunks-${ACCOUNT_ID}-eu-north-1"
```

```bash
RULER_BUCKET="voting-loki-ruler-${ACCOUNT_ID}-eu-north-1"
```

Verify bucket names:
```bash
aws s3api list-buckets \
  --query 'Buckets[].Name' \
  --output table
```

After confirming both buckets belong to this project and their logs are no longer required, delete them:
```bash
aws s3 rb "s3://${CHUNKS_BUCKET}" --force
```

```bash
aws s3 rb "s3://${RULER_BUCKET}" --force
```

These commands work for ordinary unversioned buckets. Versioned buckets require removal of all object versions and delete markers first.

## Step 13 — Terminate EC2 Instances

**WHERE: AWS CloudShell**
Identify the project instances:
```bash
aws ec2 describe-instances \
  --region eu-north-1 \
  --filters "Name=tag:Name,Values=voting-runner,voting-server" \
  --query 'Reservations[].Instances[].{ID:InstanceId,Name:Tags[?Key==`Name`]|[0].Value,State:State.Name}' \
  --output table
```

After confirming the exact instance IDs, terminate them:
```bash
aws ec2 terminate-instances \
  --region eu-north-1 \
  --instance-ids <VOTING_RUNNER_INSTANCE_ID> <VOTING_SERVER_INSTANCE_ID>
```

Replace the placeholders with verified instance IDs.

## Step 14 — Check Remaining AWS Resources

EKS:
```bash
aws eks list-clusters \
  --region eu-north-1
```

EC2:
```bash
aws ec2 describe-instances \
  --region eu-north-1 \
  --filters "Name=instance-state-name,Values=pending,running,stopped,stopping" \
  --query 'Reservations[].Instances[].InstanceId' \
  --output table
```

EBS volumes:
```bash
aws ec2 describe-volumes \
  --region eu-north-1 \
  --query 'Volumes[].{ID:VolumeId,State:State,Size:Size}' \
  --output table
```

Load Balancers:
```bash
aws elbv2 describe-load-balancers \
  --region eu-north-1 \
  --query 'LoadBalancers[].LoadBalancerName' \
  --output table
```

NAT Gateways:
```bash
aws ec2 describe-nat-gateways \
  --region eu-north-1 \
  --query 'NatGateways[].{ID:NatGatewayId,State:State}' \
  --output table
```

Elastic IPs:
```bash
aws ec2 describe-addresses \
  --region eu-north-1 \
  --query 'Addresses[].{IP:PublicIp,AllocationId:AllocationId}' \
  --output table
```

VPCs:
```bash
aws ec2 describe-vpcs \
  --region eu-north-1 \
  --query 'Vpcs[].{ID:VpcId,CIDR:CidrBlock}' \
  --output table
```

Security Groups:
```bash
aws ec2 describe-security-groups \
  --region eu-north-1 \
  --query 'SecurityGroups[].{ID:GroupId,Name:GroupName}' \
  --output table
```

Review any remaining resources and delete only those verified as belonging to the Voting App. In particular, check for leftover EBS volumes, Elastic IPs and the project EC2 security group.

## Step 15 — Final Verification

```bash
aws eks list-clusters --region eu-north-1
```

```bash
aws s3api list-buckets \
  --query 'Buckets[?contains(Name, `voting-loki`)].Name' \
  --output table
```

```bash
aws cloudformation list-stacks \
  --region eu-north-1 \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[?contains(StackName, `voting-cluster`)].StackName' \
  --output table
```

Deletion is complete when all Voting App resources have been removed and verified.
Your GitHub repository final_voting_cicd remains preserved for future deployments.
