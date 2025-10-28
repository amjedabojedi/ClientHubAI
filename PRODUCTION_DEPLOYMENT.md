# 🚀 ClientHubAI Production Deployment Guide

## 📋 **Pre-Deployment Checklist**

### **1. Azure VM Requirements**
- [ ] Ubuntu 20.04+ or CentOS 8+
- [ ] Minimum 2GB RAM, 4GB recommended
- [ ] Minimum 20GB storage, 50GB recommended
- [ ] Public IP address configured
- [ ] Security groups allow HTTP (80) and HTTPS (443)

### **2. Domain Configuration**
- [ ] Domain name registered
- [ ] DNS A record pointing to Azure VM IP
- [ ] SSL certificate ready (Let's Encrypt)

### **3. Environment Variables**
- [ ] Secure JWT secret generated
- [ ] OpenAI API key configured
- [ ] Stripe keys (if using billing)
- [ ] Email service API key
- [ ] Database credentials

---

## 🛠️ **Step-by-Step Deployment**

### **Step 1: Prepare Your Code**

1. **Update storage system** (replace Replit Object Storage):
   ```bash
   # The local file storage is already created
   # Update routes.ts to use localFileStorage instead of Replit Object Storage
   ```

2. **Create production build**:
   ```bash
   npm run build
   ```

3. **Package your application**:
   ```bash
   tar -czf clienthubai-production.tar.gz \
     dist/ \
     package.json \
     package-lock.json \
     .env.production \
     deploy-azure.sh \
     server/ \
     shared/ \
     migrations/ \
     downloaded-documents/
   ```

### **Step 2: Deploy to Azure VM**

1. **Copy files to Azure VM**:
   ```bash
   scp clienthubai-production.tar.gz user@your-azure-vm-ip:/home/user/
   ```

2. **SSH into Azure VM**:
   ```bash
   ssh user@your-azure-vm-ip
   ```

3. **Run deployment script**:
   ```bash
   chmod +x deploy-azure.sh
   ./deploy-azure.sh
   ```

4. **Extract and setup application**:
   ```bash
   cd /var/www/clienthubai
   tar -xzf ~/clienthubai-production.tar.gz
   
   # Install dependencies
   npm install --production
   
   # Copy environment file
   cp .env.production .env
   
   # Update .env with actual values
   nano .env
   ```

### **Step 3: Database Setup**

1. **Create database schema**:
   ```bash
   cd /var/www/clienthubai
   npm run db:push
   ```

2. **Import your data** (if you have a backup):
   ```bash
   # If you have a database backup
   psql -h localhost -U clienthubai_user -d clienthubai_prod < your-backup.sql
   ```

3. **Restore documents** (if you downloaded them):
   ```bash
   # Copy downloaded documents to uploads directory
   cp -r downloaded-documents/* /var/www/clienthubai/uploads/
   ```

### **Step 4: Start Application**

1. **Build the application**:
   ```bash
   npm run build
   ```

2. **Start with PM2**:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   ```

3. **Start Nginx**:
   ```bash
   sudo systemctl restart nginx
   sudo systemctl enable nginx
   ```

### **Step 5: SSL Certificate**

1. **Install SSL certificate**:
   ```bash
   sudo certbot --nginx -d your-domain.com -d www.your-domain.com
   ```

2. **Test SSL**:
   ```bash
   curl -I https://your-domain.com/health
   ```

---

## 🔧 **Configuration Updates Needed**

### **1. Update Document Storage Routes**

Replace Replit Object Storage with local file storage in `server/routes.ts`:

```typescript
// Replace this section (around line 3498-3518)
// OLD: Replit Object Storage
const { Client } = await import('@replit/object-storage');
const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });

// NEW: Local File Storage
import { localFileStorage } from './local-file-storage';

// Store file content using local storage
if (fileContent) {
  try {
    const uploadResult = await localFileStorage.storeFile(
      fileContent,
      document.originalName,
      document.mimeType,
      document.id
    );
    
    if (!uploadResult.success) {
      await storage.deleteDocument(document.id);
      throw new Error(`File storage failed: ${uploadResult.error}`);
    }
  } catch (error) {
    await storage.deleteDocument(document.id);
    throw error;
  }
}
```

### **2. Update Document Download Routes**

Replace download logic (around line 3908-3958):

```typescript
// OLD: Replit Object Storage download
const downloadResult = await objectStorage.downloadAsText(objectKey);

// NEW: Local File Storage download
const filePath = path.join(process.env.FILE_STORAGE_PATH || './uploads', document.fileName);
const fileResult = await localFileStorage.getFile(filePath);

if (fileResult.success) {
  const buffer = Buffer.from(fileResult.base64Content, 'base64');
  res.setHeader('Content-Type', document.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${document.originalName}"`);
  res.send(buffer);
} else {
  res.status(404).json({ message: "File not found in storage" });
}
```

---

## 🔒 **Security Configuration**

### **1. Firewall Rules**
```bash
# Allow HTTP and HTTPS
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 22  # SSH
sudo ufw enable
```

### **2. Database Security**
```bash
# Update PostgreSQL configuration
sudo nano /etc/postgresql/*/main/pg_hba.conf

# Add secure authentication
local   all             clienthubai_user                    md5
host    all             clienthubai_user    127.0.0.1/32    md5
```

### **3. File Permissions**
```bash
# Set proper permissions
sudo chown -R www-data:www-data /var/www/clienthubai/uploads
sudo chmod -R 755 /var/www/clienthubai/uploads
```

---

## 📊 **Monitoring & Maintenance**

### **1. Health Checks**
- Application: `curl http://localhost:5000/health`
- Database: `pg_isready -h localhost -U clienthubai_user`
- Nginx: `sudo systemctl status nginx`

### **2. Logs**
- Application logs: `/var/log/clienthubai/`
- Nginx logs: `/var/log/nginx/`
- System logs: `journalctl -u nginx`

### **3. Backups**
- Database backups run daily at 2 AM
- Backup location: `/var/backups/clienthubai/`
- Retention: 30 days

### **4. Updates**
```bash
# Update application
cd /var/www/clienthubai
git pull origin main
npm install --production
npm run build
pm2 restart clienthubai
```

---

## 🚨 **Troubleshooting**

### **Common Issues**

1. **Application won't start**:
   ```bash
   pm2 logs clienthubai
   sudo systemctl status nginx
   ```

2. **Database connection failed**:
   ```bash
   sudo systemctl status postgresql
   sudo -u postgres psql -c "SELECT 1;"
   ```

3. **File upload issues**:
   ```bash
   ls -la /var/www/clienthubai/uploads/
   sudo chown -R www-data:www-data /var/www/clienthubai/uploads
   ```

4. **SSL certificate issues**:
   ```bash
   sudo certbot renew --dry-run
   ```

---

## ✅ **Post-Deployment Verification**

1. **Test application**: Visit `https://your-domain.com`
2. **Test file upload**: Upload a document
3. **Test file download**: Download the uploaded document
4. **Test database**: Check if data is being saved
5. **Test SSL**: Verify HTTPS is working
6. **Test backups**: Check if daily backups are running

---

## 📞 **Support**

If you encounter issues:
1. Check logs: `pm2 logs clienthubai`
2. Check system status: `sudo systemctl status nginx postgresql`
3. Verify environment variables: `cat /var/www/clienthubai/.env`
4. Test database connection: `psql -h localhost -U clienthubai_user -d clienthubai_prod`
