// Simple localStorage-based storage for Plasma widget
.pragma library
    .import QtQuick.LocalStorage as LS

const DB_NAME = "IntervalTaskifyDB"
const DB_VERSION = "1.0"
const DB_DESCRIPTION = "Interval Taskify task database"
const DB_SIZE = 1000000

var db = null

function getDatabase() {
    if (db === null) {
        db = LS.LocalStorage.openDatabaseSync(DB_NAME, DB_VERSION, DB_DESCRIPTION, DB_SIZE)

        db.transaction(function (tx) {
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

    database.readTransaction(function (tx) {
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

function addTodo(plasmoid, title, config) {
    var database = getDatabase()
    var nowMs = Date.now()
    config = config || {}

    var daysAgo = Number(config.days_ago) || 0
    var anchorMs = nowMs - (daysAgo * 86400000)
    var anchorIso = new Date(anchorMs).toISOString()
    var nowIso = new Date(nowMs).toISOString()
    var todoId = null

    database.transaction(function (tx) {
        var result = tx.executeSql('INSERT INTO todos (title, created_at, last_completed_at, urgency_anchor_at, interval_days, significance, effort, domain, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [title, nowIso, daysAgo > 0 ? anchorIso : null, anchorIso,
                config.interval_days || 7, config.significance || 1.0,
                config.effort || 1.0, config.domain || "executive_mental", "active"])
        todoId = result.insertId
    })

    return todoId
}

function completeTodo(plasmoid, id) {
    var database = getDatabase()
    var completedAt = new Date().toISOString()

    database.transaction(function (tx) {
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

    database.transaction(function (tx) {
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

    database.transaction(function (tx) {
        tx.executeSql('DELETE FROM todos WHERE id = ?', [id])
    })

    return true
}

function clearAll(plasmoid) {
    var database = getDatabase()

    database.transaction(function (tx) {
        tx.executeSql('DELETE FROM todos')
        tx.executeSql('DELETE FROM completions')
    })
}

function loadSampleData(plasmoid) {
    clearAll(plasmoid)

    var sampleTodos = [
        { title: "Water plants", interval_days: 3, significance: 1.0, effort: 0.5, domain: "physical_somatic", elapsed_days: 5 },
        { title: "Plan the week", interval_days: 7, significance: 2.5, effort: 2.5, domain: "executive_mental", elapsed_days: 4 },
        { title: "Check in with family", interval_days: 14, significance: 4.0, effort: 1.0, domain: "social_relational", elapsed_days: 3 },
        { title: "Replace the air filter", interval_days: 30, significance: 1.6, effort: 1.0, domain: "physical_somatic", elapsed_days: 50 }
    ]
    var now = Date.now()
    var millisecondsPerDay = 24 * 60 * 60 * 1000
    var database = getDatabase()

    for (var i = 0; i < sampleTodos.length; i++) {
        var sample = sampleTodos[i]
        var completedAt = new Date(now - sample.elapsed_days * millisecondsPerDay).toISOString()
        var createdAt = new Date(now - (sample.elapsed_days + sample.interval_days * 2) * millisecondsPerDay).toISOString()
        var todoId = addTodo(plasmoid, sample.title, sample)

        database.transaction(function (tx) {
            tx.executeSql('UPDATE todos SET created_at = ?, last_completed_at = ?, urgency_anchor_at = ? WHERE id = ?',
                [createdAt, completedAt, completedAt, todoId])
            tx.executeSql('INSERT INTO completions (todo_id, completed_at) VALUES (?, ?)', [todoId, completedAt])
        })
    }
}

function exportFullData(plasmoid) {
    var database = getDatabase()
    var data = {
        version: "1.0",
        exported_at: new Date().toISOString(),
        todos: [],
        completions: []
    }

    database.readTransaction(function (tx) {
        var rsTodos = tx.executeSql("SELECT * FROM todos ORDER BY id ASC")
        for (var i = 0; i < rsTodos.rows.length; i++) {
            var row = rsTodos.rows.item(i)
            data.todos.push({
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

        var rsCompletions = tx.executeSql("SELECT * FROM completions ORDER BY completed_at ASC")
        for (var j = 0; j < rsCompletions.rows.length; j++) {
            var cRow = rsCompletions.rows.item(j)
            data.completions.push({
                todo_id: cRow.todo_id,
                completed_at: cRow.completed_at
            })
        }
    })

    return JSON.stringify(data, null, 2)
}

function updateTaskElapsedDays(plasmoid, id, daysAgo) {
    var database = getDatabase()
    var anchorMs = Date.now() - (Math.max(0, Number(daysAgo)) * 86400000)
    var anchorIso = new Date(anchorMs).toISOString()

    database.transaction(function (tx) {
        tx.executeSql('UPDATE todos SET urgency_anchor_at = ?, last_completed_at = ? WHERE id = ?',
            [anchorIso, anchorIso, id])
    })

    return true
}
