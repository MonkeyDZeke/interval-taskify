import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami
import "ApiClient.js" as ApiClient

PlasmoidItem {
    id: root

    width: Kirigami.Units.gridUnit * 25
    height: Kirigami.Units.gridUnit * 35

    property var todos: []
    property var summaryData: null
    property bool serverOnline: false
    property string currentFilter: "active"
    property var editingTodo: null

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
        loadTodos()
    }

    // Auto-refresh every 2 seconds to poll the REST API backend
    Timer {
        interval: 2000
        running: true
        repeat: true
        onTriggered: root.loadTodos()
    }

    function loadTodos() {
        ApiClient.getTasks("all", function(err, response) {
            if (err) {
                root.serverOnline = false
                return
            }
            root.serverOnline = true
            root.todos = response.tasks || []
        })

        ApiClient.getSummary(1.0, function(err, response) {
            if (!err) {
                root.summaryData = response
            }
        })
    }

    function addTodo(text, config) {
        if (text.trim() === "") return
        ApiClient.addTask(text.trim(), config || {}, function(err, response) {
            if (!err) loadTodos()
        })
    }

    function saveEditingTodo(text, config) {
        if (!editingTodo || text.trim() === "") return
        ApiClient.updateTask(editingTodo.id, text.trim(), config || {}, function(err, response) {
            if (!err) {
                editingTodo = null
                loadTodos()
            }
        })
    }

    function startEditing(todo) {
        editingTodo = todo
    }

    function cancelEditing() {
        editingTodo = null
    }

    function setTodoState(id, state) {
        ApiClient.setTaskState(id, state, function(err, response) {
            if (!err) loadTodos()
        })
    }

    function completeTodo(id) {
        ApiClient.completeTask(id, function(err, response) {
            if (!err) loadTodos()
        })
    }

    function deleteTodo(id) {
        ApiClient.deleteTask(id, function(err, response) {
            if (!err) loadTodos()
        })
    }

    function exportToClipboard() {
        ApiClient.exportData(function(err, data) {
            if (!err) {
                clipboardHelper.text = JSON.stringify(data, null, 2)
                clipboardHelper.selectAll()
                clipboardHelper.copy()
            }
        })
    }

    function getMetrics(todo) {
        // Use server-provided metrics if available
        if (todo.metrics) {
            return {
                elapsedDays: todo.metrics.elapsedDays || 0,
                x: todo.metrics.x || 0,
                weight: todo.metrics.weight || 0,
                statusText: todo.metrics.statusText || ""
            }
        }

        // Fallback calculation for offline rendering
        var intervalDays = Number(todo.interval_days)
        var anchor = Date.parse(todo.urgency_anchor_at)
        if (!isFinite(intervalDays) || intervalDays <= 0 || !isFinite(anchor)) {
            return { elapsedDays: 0, x: 0, weight: 0, statusText: "Invalid" }
        }

        var elapsedDays = Math.max(0, (Date.now() - anchor) / 86400000)
        var x = elapsedDays / intervalDays
        var significance = Number(todo.significance)
        var weight = x <= 1
                ? significance * Math.log(1 + 10 * x) / Math.log(11)
                : significance * Math.exp(1.386 * (x - 1))

        return { elapsedDays: elapsedDays, x: x, weight: weight, statusText: "" }
    }

    function getStatusText(todo) {
        if (todo.state !== "active") return todo.state.toUpperCase()
        var onceTag = todo.is_recurring === 0 ? "  •  Once-off" : ""
        if (todo.metrics && todo.metrics.statusText) {
            return todo.metrics.statusText + "  •  W " + todo.metrics.weight.toFixed(2) + onceTag
        }

        var metrics = getMetrics(todo)
        var intervalDays = Number(todo.interval_days)
        var diffDays = Math.round(intervalDays - metrics.elapsedDays)

        var status = ""
        if (diffDays > 0) {
            status = "Due in " + diffDays + (diffDays === 1 ? " day" : " days")
        } else if (diffDays === 0) {
            status = "Due today"
        } else {
            var overdueDays = Math.abs(diffDays)
            status = "Overdue " + overdueDays + (overdueDays === 1 ? " day" : " days")
        }

        return status + "  •  W " + metrics.weight.toFixed(2) + onceTag
    }

    function matchesFilter(todo, filter) {
        if (filter === "all") return true
        if (filter === "active") return todo.state === "active"
        if (filter === "completed") return todo.state === "completed"
        if (filter === "inactive") return todo.state !== "active" && todo.state !== "completed"
        return false
    }

    function getFilteredTodos() {
        var filtered = []
        for (var i = 0; i < todos.length; i++) {
            if (matchesFilter(todos[i], currentFilter)) filtered.push(todos[i])
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
            if (matchesFilter(todos[i], filter)) count++
        }
        return count
    }

    function getCapacitySummary() {
        if (summaryData) {
            var dl = summaryData.domain_loads || {}
            var m = dl.executive_mental ? dl.executive_mental.current : 0
            var p = dl.physical_somatic ? dl.physical_somatic.current : 0
            var s = dl.social_relational ? dl.social_relational.current : 0
            return "Total Weight: " + summaryData.total_weight.toFixed(2) + " W  |  Daily load " +
                   summaryData.total_active_cost_au.toFixed(1) + "/" + summaryData.effective_capacity_au.toFixed(1) + " AU  |  Mental " +
                   m.toFixed(1) + "/5  Physical " + p.toFixed(1) + "/4  Social " + s.toFixed(1) + "/3"
        }

        // Fallback summary computation
        var load = { executive_mental: 0, physical_somatic: 0, social_relational: 0 }
        var totalCost = 0
        var totalWeight = 0

        for (var i = 0; i < todos.length; i++) {
            var todo = todos[i]
            if (todo.state !== "active") continue
            var metrics = getMetrics(todo)
            totalWeight += metrics.weight
            var cost = todo.is_recurring === 0
                    ? Number(todo.effort) * Math.log(1 + 10 * Math.min(metrics.x, 1)) / Math.log(11)
                    : Number(todo.effort) / Number(todo.interval_days)
            if (isFinite(cost)) {
                load[todo.domain] = (load[todo.domain] || 0) + cost
                totalCost += cost
            }
        }

        return "Total Weight: " + totalWeight.toFixed(2) + " W  |  Daily load " + totalCost.toFixed(1) + "/12 AU  |  Mental " +
               load.executive_mental.toFixed(1) + "/5  Physical " + load.physical_somatic.toFixed(1) + "/4  Social " + load.social_relational.toFixed(1) + "/3"
    }

    // Hidden component used for clipboard operations
    TextEdit {
        id: clipboardHelper
        visible: false
    }

    fullRepresentation: ColumnLayout {
        Layout.minimumWidth: Kirigami.Units.gridUnit * 20
        Layout.minimumHeight: Kirigami.Units.gridUnit * 25
        Layout.preferredWidth: Kirigami.Units.gridUnit * 25
        Layout.preferredHeight: Kirigami.Units.gridUnit * 35
        spacing: 0

        // Auto-fill form when editingTodo changes
        Connections {
            target: root
            function onEditingTodoChanged() {
                if (root.editingTodo) {
                    inputField.text = root.editingTodo.title
                    intervalInput.value = Number(root.editingTodo.interval_days) || 7
                    onceInput.checked = root.editingTodo.is_recurring === 0
                    daysAgoInput.value = Math.round(root.getMetrics(root.editingTodo).elapsedDays)
                    significanceInput.currentIndex = Math.max(0, significanceInput.indexOfValue(Number(root.editingTodo.significance)))
                    effortInput.currentIndex = Math.max(0, effortInput.indexOfValue(Number(root.editingTodo.effort)))
                    domainInput.currentIndex = Math.max(0, domainInput.indexOfValue(root.editingTodo.domain))
                } else {
                    inputField.text = ""
                    intervalInput.value = 7
                    onceInput.checked = false
                    significanceInput.currentIndex = 0
                    effortInput.currentIndex = 1
                    domainInput.currentIndex = 0
                }
            }
        }

        // Header
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: Kirigami.Units.gridUnit * 13
            color: Kirigami.Theme.backgroundColor

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Kirigami.Units.largeSpacing
                spacing: Kirigami.Units.smallSpacing

                // Input field with Add / Update / Cancel buttons
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    QQC2.TextField {
                        id: inputField
                        Layout.fillWidth: true
                        Layout.preferredHeight: Kirigami.Units.gridUnit * 2.5
                        placeholderText: root.editingTodo ? "Edit task title..." : "Add a task..."
                        leftPadding: Kirigami.Units.largeSpacing
                        rightPadding: Kirigami.Units.largeSpacing

                        Keys.onReturnPressed: {
                            var config = {
                                interval_days: intervalInput.value,
                                days_ago: daysAgoInput.value,
                                significance: significanceInput.currentValue,
                                effort: effortInput.currentValue,
                                domain: domainInput.currentValue,
                                is_recurring: !onceInput.checked
                            }
                            if (root.editingTodo) {
                                root.saveEditingTodo(text, config)
                            } else {
                                root.addTodo(text, config)
                                text = ""
                            }
                        }
                    }

                    QQC2.Button {
                        visible: root.editingTodo === null
                        Layout.preferredHeight: Kirigami.Units.gridUnit * 2.5
                        text: "Add"
                        icon.name: "list-add"
                        highlighted: true
                        leftPadding: Kirigami.Units.largeSpacing * 1.5
                        rightPadding: Kirigami.Units.largeSpacing * 1.5
                        onClicked: {
                            root.addTodo(inputField.text, {
                                interval_days: intervalInput.value,
                                days_ago: daysAgoInput.value,
                                significance: significanceInput.currentValue,
                                effort: effortInput.currentValue,
                                domain: domainInput.currentValue,
                                is_recurring: !onceInput.checked
                            })
                            inputField.text = ""
                        }
                    }

                    QQC2.Button {
                        visible: root.editingTodo !== null
                        Layout.preferredHeight: Kirigami.Units.gridUnit * 2.5
                        text: "Update"
                        icon.name: "dialog-ok"
                        highlighted: true
                        leftPadding: Kirigami.Units.largeSpacing * 1.5
                        rightPadding: Kirigami.Units.largeSpacing * 1.5
                        onClicked: {
                            root.saveEditingTodo(inputField.text, {
                                interval_days: intervalInput.value,
                                days_ago: daysAgoInput.value,
                                significance: significanceInput.currentValue,
                                effort: effortInput.currentValue,
                                domain: domainInput.currentValue,
                                is_recurring: !onceInput.checked
                            })
                        }
                    }

                    QQC2.Button {
                        visible: root.editingTodo !== null
                        Layout.preferredHeight: Kirigami.Units.gridUnit * 2.5
                        text: "Cancel"
                        icon.name: "dialog-cancel"
                        onClicked: root.cancelEditing()
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    QQC2.Label { text: onceInput.checked ? "Due in" : "Every" }

                    QQC2.SpinBox {
                        id: intervalInput
                        from: 1
                        to: 3650
                        value: 7
                        editable: true
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 5
                        QQC2.ToolTip.text: "Task interval in days"
                        QQC2.ToolTip.visible: hovered
                    }

                    QQC2.Label {
                        text: onceInput.checked ? "days" : "days | Done"
                    }

                    QQC2.SpinBox {
                        id: daysAgoInput
                        visible: !onceInput.checked
                        from: 0
                        to: 3650
                        value: 0
                        editable: true
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 5
                        QQC2.ToolTip.text: "Days since task was last completed"
                        QQC2.ToolTip.visible: hovered
                    }

                    QQC2.Label {
                        text: "days ago"
                        visible: !onceInput.checked
                    }

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
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 6
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

                    QQC2.CheckBox {
                        id: onceInput
                        text: "Once-off"
                        checked: false
                        QQC2.ToolTip.text: "Task completes permanently instead of recurring"
                        QQC2.ToolTip.visible: hovered
                    }

                    QQC2.Button {
                        id: exportBtn
                        text: "Export"
                        icon.name: "document-export"
                        onClicked: {
                            root.exportToClipboard()
                            exportBtn.text = "Copied!"
                            resetTimer.start()
                        }
                        QQC2.ToolTip.text: "Copy full JSON data backup from service"
                        QQC2.ToolTip.visible: hovered

                        Timer {
                            id: resetTimer
                            interval: 2000
                            onTriggered: exportBtn.text = "Export"
                        }
                    }
                }

                // Filters & Service Status
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

                    QQC2.Button {
                        text: "Done " + root.getTodoCount("completed")
                        checkable: true
                        checked: root.currentFilter === "completed"
                        flat: !checked
                        onClicked: root.currentFilter = "completed"
                    }

                    Item { Layout.fillWidth: true }

                    // Online / Offline Status Badge
                    QQC2.Label {
                        text: root.serverOnline ? "● Service Online" : "● Offline (Cached)"
                        color: root.serverOnline ? Kirigami.Theme.positiveTextColor : Kirigami.Theme.disabledTextColor
                        font: Kirigami.Theme.smallFont
                    }
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
            width: parent ? parent.width : todoListView.width

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
                        id: statusLabel
                        Layout.fillWidth: true
                        text: root.getStatusText(itemData)
                        font: Kirigami.Theme.smallFont
                        color: {
                            if (itemData.state !== "active") return Kirigami.Theme.disabledTextColor
                            var metrics = root.getMetrics(itemData)
                            return metrics.x > 1.0 ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.disabledTextColor
                        }

                        MouseArea {
                            id: statusHover
                            anchors.fill: parent
                            hoverEnabled: true

                            QQC2.ToolTip.text: {
                                var metrics = root.getMetrics(itemData)
                                return (itemData.is_recurring === 0 ? "Once-off, due in (T): " : "Interval (T): ") + itemData.interval_days + " days\n" +
                                       "Elapsed (Δt): " + metrics.elapsedDays.toFixed(1) + " days\n" +
                                       "Interval Ratio (x): " + metrics.x.toFixed(2) + "x\n" +
                                       "Urgency Weight (W): " + metrics.weight.toFixed(2) + "\n" +
                                       "Significance (S): " + itemData.significance + "\n" +
                                       "Effort (E): " + itemData.effort + " AU"
                            }
                            QQC2.ToolTip.visible: statusHover.containsMouse
                        }
                    }
                }

                QQC2.ComboBox {
                    visible: itemData.state !== "completed"
                    Layout.alignment: Qt.AlignVCenter
                    Layout.preferredWidth: Kirigami.Units.gridUnit * 7
                    model: root.stateOptions
                    textRole: "text"
                    valueRole: "value"
                    currentIndex: indexOfValue(itemData.state)
                    onActivated: root.setTodoState(itemData.id, currentValue)
                }

                PlasmaComponents.ToolButton {
                    visible: itemData.state === "completed"
                    icon.name: "edit-undo"
                    onClicked: root.setTodoState(itemData.id, "active")
                    QQC2.ToolTip.text: "Reopen task (restarts urgency clock)"
                    QQC2.ToolTip.visible: hovered
                }

                PlasmaComponents.ToolButton {
                    visible: itemData.state === "active"
                    icon.name: "document-edit"
                    onClicked: root.startEditing(itemData)
                    QQC2.ToolTip.text: "Edit task"
                    QQC2.ToolTip.visible: hovered
                }

                PlasmaComponents.ToolButton {
                    visible: itemData.state === "active"
                    icon.name: "dialog-ok-apply"
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
