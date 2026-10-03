#!/bin/bash

# Plasma To Do widget installation script

WIDGET_NAME="taskifyintervals.plasma.todo"
WIDGET_DIR="plasma-widget"

echo "==================================="
echo "Installing the To Do widget"
echo "==================================="
echo ""

# Check that the widget directory exists
if [ ! -d "$WIDGET_DIR" ]; then
    echo "❌ Error: Widget directory $WIDGET_DIR does not exist"
    exit 1
fi

# Check that kpackagetool6 is installed
if ! command -v kpackagetool6 &> /dev/null; then
    echo "❌ Error: kpackagetool6 is not installed"
    echo "Install it with: sudo pacman -S plasma-framework (Arch) or sudo apt install plasma-framework (Debian/Ubuntu)"
    exit 1
fi

# Uninstall the widget if it is already installed
echo "🔍 Checking for an existing installation..."
if kpackagetool6 --type=Plasma/Applet --show="$WIDGET_NAME" &> /dev/null; then
    echo "⚠️  Widget already installed; uninstalling..."
    kpackagetool6 --type=Plasma/Applet --remove="$WIDGET_NAME"
fi

# Install the widget
echo "📦 Installing the widget..."
kpackagetool6 --type=Plasma/Applet --install "$WIDGET_DIR"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Widget installed successfully!"
    echo ""
    echo "To use it:"
    echo "1. Right-click the desktop or panel"
    echo "2. Select 'Add Widgets...'"
    echo "3. Search for 'To Do'"
    echo "4. Drag the widget onto your desktop or panel"
    echo ""
    echo "To uninstall:"
    echo "  kpackagetool6 --type=Plasma/Applet --remove=$WIDGET_NAME"
    echo ""
else
    echo ""
    echo "❌ Installation failed"
    exit 1
fi
