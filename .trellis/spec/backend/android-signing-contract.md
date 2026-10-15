# Android 历史签名与覆盖升级契约

本机留存的真实 0.4.1 APK：`com.binote.app`，versionCode 4001，与 0.3.0 使用同一证书。证书 SHA256 固定为 `.github/android-signing-certificate.sha256` 中的值。密钥别名、APK 文件名、`release` 构建类型都不能代替证书一致性检查。

## 发布要求

- GitHub Actions 使用原密钥的仓库 Secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。禁止把私钥、密码或 Base64 内容写入源码、日志、Artifact 或 Release。
- 任一配置缺失时必须提前失败，禁止临时生成替代密钥继续发布。
- APK 必须通过 `apksigner verify --verbose --print-certs`，再由 `binote/scripts/verify-android-signing.cjs` 确认单一原证书；不匹配则停止上传与 Release 创建。随后验证 ZIP 对齐。
- 安装包命名 `BiNote_<版本>_arm64.apk`。包名保持 `com.binote.app`，版本号升高；覆盖升级使用安装器更新或 `adb install -r`，不卸载、不清数据。
- 原签名私钥不得随意轮换。即使新建密钥也“能签名”，证书不同仍不能接续此历史应用的更新。

## 数据保留验证

在隔离 Android 设备中安装真实 0.4.1、放入无 preview 的旧格式测试笔记和设置，记录 UID、首次安装时间以及 notes/config 文件哈希；覆盖安装后验证 UID、首次安装时间及两个哈希一致，笔记数和完整内容可读。真实用户设备未连接时，不把模拟器验收宣称为用户手机实测，也不卸载旧应用以绕过签名冲突。

`npm run test:android-signing` 覆盖原证书、错误证书、未验证或缺失结果、多签名者及公钥摘要冒充。若用户曾安装其他云端临时签名包，应先核对其证书，不允许通过卸载来冒险丢失笔记。
