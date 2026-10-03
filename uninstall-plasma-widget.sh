#!/bin/bash

# Plasma To Do widget uninstallation script

WIDGET_NAME="taskifyintervals.plasma.todo"

echo "==================================="
echo "Uninstalling the To Do widget"
echo "==================================="
echo ""

# Check that kpackagetool6 is installed
if ! command -v kpackagetool6 &> /dev/null; then
    echo "❌ Error: kpackagetool6 is not installed"
    exit 1
fi

# Check whether the widget is installed
echo "🔍 Checking the installation..."
if ! kpackagetool6 --type=Plasma/Applet --show="$WIDGET_NAME" &> /dev/null; then
    echo "⚠️  The widget is not installed"
    exit 0
fi

# Uninstall the widget
echo "🗑️  Uninstalling the widget..."
kpackagetool6 --type=Plasma/Applet --remove="$WIDGET_NAME"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Widget uninstalled successfully!"
    echo ""
else
    echo ""
    echo "❌ Uninstallation failed"
    exit 1
fi
