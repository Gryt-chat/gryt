# The slim build: same client, no embedded server. Everything except the cask
# token, desc, conflicts_with and the url must match gryt-chat.rb, and
# check-homebrew-casks.mjs holds them to that.
#
# version and both sha256 values are placeholders. publish-homebrew.yml
# rewrites all three.
cask "gryt-chat-slim" do
  arch arm: "arm64", intel: "x64"

  version "0.0.0"
  # Two different placeholders because `brew style` rejects identical per-arch
  # checksums, and because a leftover one is then obvious in the published cask.
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000000",
         intel: "1111111111111111111111111111111111111111111111111111111111111111"

  url "https://github.com/Gryt-chat/gryt/releases/download/v#{version}/Gryt-Chat-#{version}-mac-#{arch}-slim.dmg"
  name "Gryt Chat"
  desc "Real-time voice chat, without the built-in server"
  homepage "https://gryt.chat/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Without this, brew upgrade reinstalls over a copy electron-updater has
  # already moved on.
  auto_updates true
  # Same app bundle, so brew has to pick one.
  conflicts_with cask: "gryt-chat"
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
