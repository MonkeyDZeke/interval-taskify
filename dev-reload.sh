#!/bin/bash

# Development script: reinstall and reload Plasma

WIDGET_NAME="taskifyintervals.plasma.todo"
WIDGET_DIR="clients/plasma-widget"

echo "🔄 Updating widget..."

# Uninstall
kpackagetool6 --type=Plasma/Applet --remove="$WIDGET_NAME" &> /dev/null

# Reinstall
kpackagetool6 --type=Plasma/Applet --install "$WIDGET_DIR"

if [ $? -eq 0 ]; then
    echo "✅ Widget reinstalled"
    echo "🔄 Restarting Plasma..."
    plasmashell --replace &> /dev/null &

    echo "✅ Done! The widget has been updated."
else
    echo "❌ Widget reinstallation failed"
    exit 1
fi
