param([Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Path $Directory -Force | Out-Null
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
try {
  $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=localhost", $rsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
  $names = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $names.AddDnsName("localhost")
  $names.AddIpAddress([System.Net.IPAddress]::Parse("127.0.0.1"))
  $request.CertificateExtensions.Add($names.Build($false))
  $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(2))
  try {
    [IO.File]::WriteAllText((Join-Path $Directory "localhost-cert.pem"), $certificate.ExportCertificatePem())
    [IO.File]::WriteAllText((Join-Path $Directory "localhost-key.pem"), $rsa.ExportPkcs8PrivateKeyPem())
  } finally { $certificate.Dispose() }
} finally { $rsa.Dispose() }
Write-Output "Created an ephemeral loopback certificate; no certificate store was changed."
