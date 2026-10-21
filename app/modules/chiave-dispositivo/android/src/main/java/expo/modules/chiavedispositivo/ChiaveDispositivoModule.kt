package expo.modules.chiavedispositivo

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

class ChiaveDispositivoModule : Module() {
  private val alias = "interpellati_dispositivo_v1"

  override fun definition() = ModuleDefinition {
    Name("ChiaveDispositivo")
    Function("chiavePubblica") { spki() }
    Function("idDispositivo") {
      val der = Base64.decode(spki(), Base64.NO_WRAP)
      MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) }.substring(0, 32)
    }
    Function("firma") { messaggio: String ->
      val chiave = keyStore().getKey(alias, null) as PrivateKey
      val s = Signature.getInstance("SHA256withECDSA")
      s.initSign(chiave)
      s.update(messaggio.toByteArray(Charsets.UTF_8))
      Base64.encodeToString(s.sign(), Base64.NO_WRAP)
    }
    Function("hardware") {
      try {
        assicuraChiave()
        val chiave = keyStore().getKey(alias, null) as PrivateKey
        val info = KeyFactory.getInstance(chiave.algorithm, "AndroidKeyStore").getKeySpec(chiave, KeyInfo::class.java)
        if (Build.VERSION.SDK_INT >= 31) info.securityLevel != KeyProperties.SECURITY_LEVEL_SOFTWARE else @Suppress("DEPRECATION") info.isInsideSecureHardware
      } catch (e: Exception) {
        false
      }
    }
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun genera(strongBox: Boolean) {
    val g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    val b = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
    if (strongBox && Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(true)
    g.initialize(b.build())
    g.generateKeyPair()
  }

  @Synchronized
  private fun assicuraChiave() {
    if (keyStore().containsAlias(alias)) return
    try {
      genera(true)
    } catch (e: Exception) {
      try { keyStore().deleteEntry(alias) } catch (_: Exception) {}
      genera(false)
    }
  }

  private fun spki(): String {
    assicuraChiave()
    val cert = keyStore().getCertificate(alias)
    return Base64.encodeToString(cert.publicKey.encoded, Base64.NO_WRAP)
  }
}
