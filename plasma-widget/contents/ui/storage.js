// Simple localStorage-based storage for Plasma widget
.pragma library
.import QtQuick.LocalStorage 2.0 as LS

const DB_NAME = "IntervalTaskifyDB"
const DB_VERSION = "1.0"
const DB_DESCRIPTION = "Interval Taskify task database"
const DB_SIZE = 1000000

var db = null

function getDatabase() {
    if (db === null) {
        db = LS.LocalStorage.openDatabaseSync(DB_NAME, DB_VERSION, DB_DESCRIPTION, DB_SIZE)

        db.transaction(function(tx) {
            tx.executeSql('CREATE TABLE IF NOT EXISTS todos(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, created_at TEXT NOT NULL, last_completed_at TEXT, urgency_anchor_at TEXT NOT NULL, interval_days REAL NOT NULL, significance REAL NOT NULL, effort REAL NOT NULL, domain TEXT NOT NULL, state TEXT NOT NULL DEFAULT \'active\', frozen_at TEXT)')
            tx.executeSql('CREATE TABLE IF NOT EXISTS completions(todo_id INTEGER NOT NULL, completed_at TEXT NOT NULL)')
        })
    }
    return db
}

function initDatabase(plasmoid) {
    getDatabase()
}

function getAllTodos(plasmoid) {
    var todos = []
    var database = getDatabase()

    database.readTransaction(function(tx) {
        var rs = tx.executeSql("SELECT * FROM todos ORDER BY CASE WHEN state = 'active' THEN 0 ELSE 1 END, created_at DESC")
        for (var i = 0; i < rs.rows.length; i++) {
            var row = rs.rows.item(i)
            todos.push({
                id: row.id,
                title: row.title,
                created_at: row.created_at,
                last_completed_at: row.last_completed_at,
                urgency_anchor_at: row.urgency_anchor_at,
                interval_days: row.interval_days,
                significance: row.significance,
                effort: row.effort,
                domain: row.domain,
                state: row.state,
                frozen_at: row.frozen_at
            })
        }
    })

    return todos
}

function addTodo(plasmoid, title) {
    var database = getDatabase()
    var now = new Date().toISOString()

    database.transaction(function(tx) {
        tx.executeSql('INSERT INTO todos (title, created_at, urgency_anchor_at, interval_days, significance, effort, domain, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                     [title, now, now, 1.0, 1.0, 1.0, "executive_mental", "active"])
    })

    return true
}

function completeTodo(plasmoid, id) {
    var database = getDatabase()
    var completedAt = new Date().toISOString()

    database.transaction(function(tx) {
        var result = tx.executeSql('SELECT state FROM todos WHERE id = ?', [id])
        if (result.rows.length === 0 || result.rows.item(0).state !== "active") return

        tx.executeSql('INSERT INTO completions (todo_id, completed_at) VALUES (?, ?)', [id, completedAt])
        tx.executeSql('UPDATE todos SET last_completed_at = ?, urgency_anchor_at = ?, frozen_at = NULL WHERE id = ?',
                     [completedAt, completedAt, id])
    })

    return true
}

function setTodoState(plasmoid, id, state) {
    if (["active", "frozen", "hidden", "paused"].indexOf(state) === -1) return false

    var database = getDatabase()
    var now = new Date().toISOString()

    database.transaction(function(tx) {
        var result = tx.executeSql('SELECT state, urgency_anchor_at, frozen_at FROM todos WHERE id = ?', [id])
        if (result.rows.length === 0) return

        var todo = result.rows.item(0)
        var urgencyAnchor = todo.urgency_anchor_at
        var frozenAt = todo.frozen_at

        if (todo.state === "frozen" && state !== "frozen" && frozenAt) {
            var frozenDuration = Date.parse(now) - Date.parse(frozenAt)
            urgencyAnchor = new Date(Date.parse(urgencyAnchor) + frozenDuration).toISOString()
            frozenAt = null
        }

        if (todo.state === "paused" && state !== "paused") {
            urgencyAnchor = now
        }

        if (state === "frozen" && todo.state !== "frozen") {
            frozenAt = now
        } else if (state !== "frozen") {
            frozenAt = null
        }

        tx.executeSql('UPDATE todos SET state = ?, urgency_anchor_at = ?, frozen_at = ? WHERE id = ?',
                     [state, urgencyAnchor, frozenAt, id])
    })

    return true
}

function deleteTodo(plasmoid, id) {
    var database = getDatabase()

    database.transaction(function(tx) {
        tx.executeSql('DELETE FROM todos WHERE id = ?', [id])
    })

    return true
}

function clearAll(plasmoid) {
    var database = getDatabase()

    database.transaction(function(tx) {
        tx.executeSql('DELETE FROM todos')
        tx.executeSql('DELETE FROM completions')
    })
}

function loadSampleData(plasmoid) {
    clearAll(plasmoid)

    var sampleTodos = [
        "Buy bread",
        "Call the dentist",
        "Finish the report",
        "Reply to emails",
        "Pay the bills",
        "Clean the kitchen",
        "Prepare presentation",
        "Review the budget"
    ]

    for (var i = 0; i < sampleTodos.length; i++) {
        addTodo(plasmoid, sampleTodos[i])
    }
}
