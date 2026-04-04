#!/bin/bash
# Patches @capacitor-community/apple-sign-in for Capacitor 8 + Apple Sign In fixes
PLUGIN_DIR="node_modules/@capacitor-community/apple-sign-in"
[ -d "$PLUGIN_DIR" ] || exit 0

# Fix SPM version requirement for Capacitor 8
sed -i '' 's/from: "7.0.0"/from: "8.0.0"/' "$PLUGIN_DIR/Package.swift" 2>/dev/null || true

# Replace Plugin.swift with fixed version:
# - Add presentationContextProvider (fixes error 1000)
# - Dispatch performRequests to main thread
# - Safe unwrap identityToken/authorizationCode (no force-unwrap crash)
# - Robust window lookup via UIWindowScene
cat > "$PLUGIN_DIR/ios/Sources/SignInWithApple/Plugin.swift" << 'SWIFT'
import Foundation
import Capacitor
import AuthenticationServices

@objc(SignInWithApple)
public class SignInWithApple: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SignInWithApple"
    public let jsName = "SignInWithApple"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
    ]

    @objc func authorize(_ call: CAPPluginCall) {
        let appleIDProvider = ASAuthorizationAppleIDProvider()
        let request = appleIDProvider.createRequest()
        request.requestedScopes = getRequestedScopes(from: call)
        request.state = call.getString("state")
        request.nonce = call.getString("nonce")

        let defaults = UserDefaults()
        defaults.setValue(call.callbackId, forKey: "callbackId")

        self.bridge?.saveCall(call)

        DispatchQueue.main.async {
            let authorizationController = ASAuthorizationController(authorizationRequests: [request])
            authorizationController.delegate = self
            authorizationController.presentationContextProvider = self
            authorizationController.performRequests()
        }
    }

    func getRequestedScopes(from call: CAPPluginCall) -> [ASAuthorization.Scope]? {
        var requestedScopes: [ASAuthorization.Scope] = []

        if let scopesStr = call.getString("scopes") {
            if scopesStr.contains("name") {
                requestedScopes.append(.fullName)
            }

            if scopesStr.contains("email") {
                requestedScopes.append(.email)
            }
        }

        if requestedScopes.count > 0 {
            return requestedScopes
        }

        return nil
    }
}

extension SignInWithApple: ASAuthorizationControllerDelegate {
    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential else { return }

        let defaults = UserDefaults()
        let id = defaults.string(forKey: "callbackId") ?? ""
        guard let call = self.bridge?.savedCall(withID: id) else {
            return
        }

        let result: [String: Any] = [
            "response": [
                "user": appleIDCredential.user,
                "email": appleIDCredential.email as Any,
                "givenName": appleIDCredential.fullName?.givenName as Any,
                "familyName": appleIDCredential.fullName?.familyName as Any,
                "identityToken": String(data: appleIDCredential.identityToken ?? Data(), encoding: .utf8) ?? "",
                "authorizationCode": String(data: appleIDCredential.authorizationCode ?? Data(), encoding: .utf8) ?? ""
            ]
        ]

        call.resolve(result)
        self.bridge?.releaseCall(call)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let defaults = UserDefaults()
        let id = defaults.string(forKey: "callbackId") ?? ""
        guard let call = self.bridge?.savedCall(withID: id) else {
            return
        }
        call.reject(error.localizedDescription, "\((error as NSError).code)")
        self.bridge?.releaseCall(call)
    }
}

extension SignInWithApple: ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let window = self.bridge?.viewController?.view.window {
            return window
        }
        if let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap({ $0.windows })
            .first(where: { $0.isKeyWindow }) {
            return window
        }
        return ASPresentationAnchor()
    }
}
SWIFT
