import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami
import "storage.js" as Storage

PlasmoidItem {
    id: root

    width: Kirigami.Units.gridUnit * 25
    height: Kirigami.Units.gridUnit * 35

    preferredRepresentation: compactRepresentation

    property var todos: []
    property string currentFilter: "active"
    readonly property var stateOptions: [
        { text: "Active", value: "active" },
        { text: "Frozen", value: "frozen" },
        { text: "Hidden", value: "hidden" },
        { text: "Paused", value: "paused" }
    ]
    readonly property var domainOptions: [
        { text: "Mental / Executive", value: "executive_mental" },
        { text: "Physical / Somatic", value: "physical_somatic" },
        { text: "Social / Relational", value: "social_relational" }
    ]

    Component.onCompleted: {
        Storage.initDatabase(plasmoid)
        loadTodos()
    }

    // Auto-refresh every second to sync between instances
    Timer {
        interval: 1000
        running: true
        repeat: true
        onTriggered: root.loadTodos()
    }

    function loadTodos() {
        todos = Storage.getAllTodos(plasmoid)
    }

    function addTodo(text) {
        if (text.trim() === "") return
        Storage.addTodo(plasmoid, text.trim(), {
            interval_days: intervalInput.value,
            significance: significanceInput.currentValue,
            effort: effortInput.currentValue,
            domain: domainInput.currentValue
        })
        loadTodos()
    }

    function setTodoState(id, state) {
        Storage.setTodoState(plasmoid, id, state)
        loadTodos()
    }

    function completeTodo(id) {
        Storage.completeTodo(plasmoid, id)
        loadTodos()
    }

    function deleteTodo(id) {
        Storage.deleteTodo(plasmoid, id)
        loadTodos()
    }

    function clearAllTodos() {
        Storage.clearAll(plasmoid)
        loadTodos()
    }

    function loadSampleData() {
        Storage.loadSampleData(plasmoid)
        loadTodos()
    }

    function getMetrics(todo) {
        var intervalDays = Number(todo.interval_days)
        var anchor = Date.parse(todo.urgency_anchor_at)
        if (!isFinite(intervalDays) || intervalDays <= 0 || !isFinite(anchor)) {
            return { elapsedDays: 0, x: 0, weight: 0 }
        }

        var elapsedDays = Math.max(0, (Date.now() - anchor) / 86400000)
        elapsedDays = Math.min(elapsedDays, Math.max(intervalDays * 10, 183))
        var x = elapsedDays / intervalDays
        var significance = Number(todo.significance)
        var weight = x <= 1
                ? significance * Math.log(1 + 10 * x) / Math.log(11)
                : significance * Math.exp(1.386 * (x - 1))
        return { elapsedDays: elapsedDays, x: x, weight: weight }
    }

    function getFilteredTodos() {
        var filtered = []
        for (var i = 0; i < todos.length; i++) {
            var todo = todos[i]
            if (currentFilter === "all") {
                filtered.push(todo)
            } else if (currentFilter === "active" && todo.state === "active") {
                filtered.push(todo)
            } else if (currentFilter === "inactive" && todo.state !== "active") {
                filtered.push(todo)
            }
        }
        filtered.sort(function(left, right) {
            var leftActive = left.state === "active"
            var rightActive = right.state === "active"
            if (leftActive !== rightActive) return leftActive ? -1 : 1
            if (leftActive) return getMetrics(right).weight - getMetrics(left).weight
            return left.title.localeCompare(right.title)
        })
        return filtered
    }

    function getTodoCount(filter) {
        var count = 0
        for (var i = 0; i < todos.length; i++) {
            if (filter === "all") {
                count++
            } else if (filter === "active" && todos[i].state === "active") {
                count++
            } else if (filter === "inactive" && todos[i].state !== "active") {
                count++
            }
        }
        return count
    }

    function getCapacitySummary() {
        var load = {
            executive_mental: 0,
            physical_somatic: 0,
            social_relational: 0
        }
        var total = 0
        for (var i = 0; i < todos.length; i++) {
            var todo = todos[i]
            if (todo.state !== "active") continue
            var cost = Number(todo.effort) / Number(todo.interval_days)
            if (!isFinite(cost)) continue
            load[todo.domain] = (load[todo.domain] || 0) + cost
            total += cost
        }

        return "Daily load " + total.toFixed(1) + "/12 AU  |  Mental " + load.executive_mental.toFixed(1) + "/5" +
                "  Physical " + load.physical_somatic.toFixed(1) + "/4  Social " + load.social_relational.toFixed(1) + "/3"
    }

    // Compact representation (for panel)
    compactRepresentation: Item {
        Layout.preferredWidth: Kirigami.Units.iconSizes.medium
        Layout.preferredHeight: Kirigami.Units.iconSizes.medium

        Kirigami.Icon {
            id: icon
            anchors.fill: parent
            source: "view-list-details"
            active: mouseArea.containsMouse

            // Badge showing number of incomplete todos
            Rectangle {
                visible: {
                    var incomplete = 0
                    for (var i = 0; i < root.todos.length; i++) {
                        if (root.todos[i].state === "active") incomplete++
                    }
                    return incomplete > 0
                }
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.rightMargin: -4
                anchors.topMargin: -4
                width: Math.max(16, badgeText.width + 6)
                height: 16
                radius: 8
                color: Kirigami.Theme.highlightColor

                QQC2.Label {
                    id: badgeText
                    anchors.centerIn: parent
                    text: {
                        var incomplete = 0
                        for (var i = 0; i < root.todos.length; i++) {
                            if (root.todos[i].state === "active") incomplete++
                        }
                        return incomplete > 99 ? "99+" : incomplete.toString()
                    }
                    color: "white"
                    font.pixelSize: 10
                    font.bold: true
                }
            }
        }

        MouseArea {
            id: mouseArea
            anchors.fill: parent
            hoverEnabled: true
            onClicked: root.expanded = !root.expanded
        }
    }

    fullRepresentation: ColumnLayout {
        Layout.minimumWidth: Kirigami.Units.gridUnit * 20
        Layout.minimumHeight: Kirigami.Units.gridUnit * 25
        Layout.preferredWidth: Kirigami.Units.gridUnit * 25
        Layout.preferredHeight: Kirigami.Units.gridUnit * 35
        spacing: 0

        // Header
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: Kirigami.Units.gridUnit * 13
            color: Kirigami.Theme.backgroundColor

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Kirigami.Units.largeSpacing
                spacing: Kirigami.Units.smallSpacing

                // Input field with Add button
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    QQC2.TextField {
                        id: inputField
                        Layout.fillWidth: true
                        Layout.preferredHeight: Kirigami.Units.gridUnit * 2.5
                        placeholderText: "Add a task..."
                        leftPadding: Kirigami.Units.largeSpacing
                        rightPadding: Kirigami.Units.largeSpacing

                        Keys.onReturnPressed: {
                            root.addTodo(text)
                            text = ""
                        }
                    }

                    QQC2.Button {
                        Layout.preferredHeight: Kirigami.Units.gridUnit * 2.5
                        text: "Add"
                        icon.name: "list-add"
                        highlighted: true
                        leftPadding: Kirigami.Units.largeSpacing * 1.5
                        rightPadding: Kirigami.Units.largeSpacing * 1.5
                        onClicked: {
                            root.addTodo(inputField.text)
                            inputField.text = ""
                        }
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    QQC2.Label { text: "Every" }

                    QQC2.SpinBox {
                        id: intervalInput
                        from: 1
                        to: 3650
                        value: 7
                        editable: true
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 6
                        QQC2.ToolTip.text: "Task interval in days"
                        QQC2.ToolTip.visible: hovered
                    }

                    QQC2.Label { text: "days" }

                    QQC2.ComboBox {
                        id: significanceInput
                        Layout.fillWidth: true
                        model: [
                            { text: "Low", value: 1.0 },
                            { text: "Medium", value: 1.6 },
                            { text: "High", value: 2.5 },
                            { text: "Critical", value: 4.0 }
                        ]
                        textRole: "text"
                        valueRole: "value"
                        QQC2.ToolTip.text: "Significance"
                        QQC2.ToolTip.visible: hovered
                    }

                    QQC2.ComboBox {
                        id: effortInput
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 7
                        model: [
                            { text: "Quick", value: 0.5 },
                            { text: "Standard", value: 1.0 },
                            { text: "Heavy", value: 2.5 }
                        ]
                        textRole: "text"
                        valueRole: "value"
                        QQC2.ToolTip.text: "Effort"
                        QQC2.ToolTip.visible: hovered
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    QQC2.ComboBox {
                        id: domainInput
                        Layout.fillWidth: true
                        model: root.domainOptions
                        textRole: "text"
                        valueRole: "value"
                    }

                    QQC2.Button {
                        text: "Demo data"
                        icon.name: "view-refresh"
                        onClicked: root.loadSampleData()
                        QQC2.ToolTip.text: "Replace all tasks with example data"
                        QQC2.ToolTip.visible: hovered
                    }
                }

                // Filters
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    QQC2.Button {
                        text: "All " + root.getTodoCount("all")
                        checkable: true
                        checked: root.currentFilter === "all"
                        flat: !checked
                        onClicked: root.currentFilter = "all"
                    }

                    QQC2.Button {
                        text: "Active " + root.getTodoCount("active")
                        checkable: true
                        checked: root.currentFilter === "active"
                        flat: !checked
                        onClicked: root.currentFilter = "active"
                    }

                    QQC2.Button {
                        text: "Inactive " + root.getTodoCount("inactive")
                        checkable: true
                        checked: root.currentFilter === "inactive"
                        flat: !checked
                        onClicked: root.currentFilter = "inactive"
                    }

                    Item { Layout.fillWidth: true }
                }
            }
        }

        // Separator
        Kirigami.Separator {
            Layout.fillWidth: true
        }

        QQC2.Label {
            Layout.fillWidth: true
            Layout.preferredHeight: Kirigami.Units.gridUnit * 2.5
            Layout.leftMargin: Kirigami.Units.largeSpacing
            Layout.rightMargin: Kirigami.Units.largeSpacing
            verticalAlignment: Text.AlignVCenter
            wrapMode: Text.Wrap
            text: root.getCapacitySummary()
            color: Kirigami.Theme.disabledTextColor
            font: Kirigami.Theme.smallFont
        }

        Kirigami.Separator {
            Layout.fillWidth: true
        }

        // Todo list
        QQC2.ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ListView {
                id: todoListView
                clip: true
                spacing: 0

                model: root.getFilteredTodos()

                delegate: Loader {
                    width: todoListView.width
                    sourceComponent: todoComponent

                    property var itemData: modelData
                }
            }
        }
    }

    Component {
        id: todoComponent

        PlasmaComponents.ItemDelegate {
            height: Kirigami.Units.gridUnit * 5
            width: ListView.view.width

            contentItem: RowLayout {
                spacing: Kirigami.Units.largeSpacing

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0

                    QQC2.Label {
                        Layout.fillWidth: true
                        text: itemData.title
                        elide: Text.ElideRight
                        font.bold: itemData.state === "active"
                        color: itemData.state === "active" ? Kirigami.Theme.textColor : Kirigami.Theme.disabledTextColor
                    }

                    QQC2.Label {
                        Layout.fillWidth: true
                        text: {
                            if (itemData.state !== "active") return itemData.state
                            var metrics = root.getMetrics(itemData)
                            return "W " + metrics.weight.toFixed(2) + "  |  x " + metrics.x.toFixed(2)
                        }
                        color: Kirigami.Theme.disabledTextColor
                        font: Kirigami.Theme.smallFont
                    }
                }

                QQC2.ComboBox {
                    Layout.alignment: Qt.AlignVCenter
                    Layout.preferredWidth: Kirigami.Units.gridUnit * 7
                    model: root.stateOptions
                    textRole: "text"
                    valueRole: "value"
                    currentIndex: indexOfValue(itemData.state)
                    onActivated: root.setTodoState(itemData.id, currentValue)
                }

                PlasmaComponents.ToolButton {
                    visible: itemData.state === "active"
                    icon.name: "task-complete"
                    onClicked: root.completeTodo(itemData.id)
                    QQC2.ToolTip.text: "Mark complete"
                    QQC2.ToolTip.visible: hovered
                }

                PlasmaComponents.ToolButton {
                    icon.name: "edit-delete"
                    onClicked: root.deleteTodo(itemData.id)
                    QQC2.ToolTip.text: "Delete task"
                    QQC2.ToolTip.visible: hovered
                }
            }
        }
    }
}
