#!/bin/bash
# Patches @capacitor-community/apple-sign-in for Capacitor 8 + presentationContextProvider fix
PLUGIN_DIR="node_modules/@capacitor-community/apple-sign-in"
[ -d "$PLUGIN_DIR" ] || exit 0

# Fix SPM version requirement for Capacitor 8
sed -i '' 's/from: "7.0.0"/from: "8.0.0"/' "$PLUGIN_DIR/Package.swift" 2>/dev/null || true

# Add presentationContextProvider to fix ASAuthorizationError 1000
SWIFT_FILE="$PLUGIN_DIR/ios/Sources/SignInWithApple/Plugin.swift"
if ! grep -q "presentationContextProvider" "$SWIFT_FILE" 2>/dev/null; then
  # Add presentationContextProvider = self after delegate = self
  sed -i '' 's/authorizationController.delegate = self/authorizationController.delegate = self\
        authorizationController.presentationContextProvider = self/' "$SWIFT_FILE"

  # Add the ASAuthorizationControllerPresentationContextProviding extension
  cat >> "$SWIFT_FILE" << 'SWIFT'

extension SignInWithApple: ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return self.bridge?.webView?.window ?? ASPresentationAnchor()
    }
}
SWIFT
fi
