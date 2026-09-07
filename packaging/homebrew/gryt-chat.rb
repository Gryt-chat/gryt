# version and sha256 are placeholders. publish-homebrew.yml rewrites both.
cask "gryt-chat" do
  version "0.0.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  # Slim, matching what the site hands over by default.
  url "https://github.com/Gryt-chat/gryt/releases/download/v#{version}/Gryt-Chat-#{version}-mac-arm64-slim.dmg",
      verified: "github.com/Gryt-chat/gryt/"
  name "Gryt Chat"
  desc "Real-time voice chat"
  homepage "https://gryt.chat/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Without this, brew upgrade reinstalls over a copy electron-updater has
  # already moved on.
  auto_updates true
  # No Intel artefact is built, and the DMG has no x86_64 slice for Rosetta.
  depends_on arch: :arm64
  depends_on macos: :monterey

  app "Gryt Chat.app"

  # Only on --zap, never on an ordinary uninstall: this holds the identity
  # keypair, and losing it loses every server the person had joined.
  zap trash: [
    "~/Library/Application Support/Gryt Chat",
    "~/Library/Caches/com.gryt.chat",
    "~/Library/Caches/com.gryt.chat.ShipIt",
    "~/Library/HTTPStorages/com.gryt.chat",
    "~/Library/Preferences/com.gryt.chat.plist",
    "~/Library/Saved Application State/com.gryt.chat.savedState",
  ]
end
