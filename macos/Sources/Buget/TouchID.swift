import CryptoKit
import Foundation
import LocalAuthentication

/// Déverrouillage par empreinte. Le mot de passe de la base est chiffré (AES-GCM) avec une clé dérivée d'un échange ECDH
/// dont la moitié privée vit dans la Secure Enclave, utilisable seulement après Touch ID, sur ce Mac uniquement,
/// et invalidée si l'ensemble des empreintes change (.biometryCurrentSet). Sans empreinte, le fichier stocké est inexploitable.
enum TouchID {
    static var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Buget", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return dir.appendingPathComponent("touchid.json")
    }
    private struct Stored: Codable { var v = 1; let enclaveKey: Data; let ephemeralPublic: Data; let box: Data }
    private static let salt = Data("buget-touchid-v1".utf8)

    static var available: Bool {
        var err: NSError?
        return SecureEnclave.isAvailable && LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err)
    }
    static var enrolled: Bool { FileManager.default.fileExists(atPath: file.path) }

    static func enroll(secret: String) throws {
        guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], nil)
        else { throw err("Contrôle d’accès indisponible") }
        let enclave = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: ac)
        let eph = P256.KeyAgreement.PrivateKey() // éphémère : sa clé privée est jetée après le chiffrement
        let key = try eph.sharedSecretFromKeyAgreement(with: enclave.publicKey).hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: Data(), outputByteCount: 32)
        let box = try AES.GCM.seal(Data(secret.utf8), using: key).combined!
        let data = try JSONEncoder().encode(Stored(enclaveKey: enclave.dataRepresentation, ephemeralPublic: eph.publicKey.rawRepresentation, box: box))
        try data.write(to: file, options: [.atomic, .completeFileProtection])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    /// Demande l'empreinte puis renvoie le mot de passe. nil si l'utilisateur annule ou choisit le mot de passe.
    static func unlock() async throws -> String? {
        let s = try JSONDecoder().decode(Stored.self, from: Data(contentsOf: file))
        let ctx = LAContext()
        ctx.localizedFallbackTitle = "Utiliser le mot de passe"
        ctx.localizedCancelTitle = "Annuler"
        do { try await ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "déverrouiller Budget") }
        catch let e as LAError where [.userCancel, .userFallback, .systemCancel, .appCancel].contains(e.code) { return nil }
        do {
            let enclave = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: s.enclaveKey, authenticationContext: ctx)
            let key = try enclave.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(rawRepresentation: s.ephemeralPublic))
                .hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: Data(), outputByteCount: 32)
            let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: s.box), using: key)
            return String(decoding: plain, as: UTF8.self)
        } catch {
            // empreintes modifiées (ou clé invalidée) : on oublie, le mot de passe reprend la main
            disable()
            throw err("Les empreintes de ce Mac ont changé : saisis ton mot de passe pour réactiver Touch ID.")
        }
    }

    static func disable() { try? FileManager.default.removeItem(at: file) }
    private static func err(_ m: String) -> NSError { NSError(domain: "Buget", code: 1, userInfo: [NSLocalizedDescriptionKey: m]) }
}
