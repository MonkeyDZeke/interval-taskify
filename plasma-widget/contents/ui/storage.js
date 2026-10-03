// Simple localStorage-based storage for Plasma widget
.pragma library
.import QtQuick.LocalStorage 2.0 as LS

const DB_NAME = "ToDoDB"
const DB_VERSION = "1.0"
const DB_DESCRIPTION = "Interval Taskify task database"
const DB_SIZE = 1000000

var nextId = 1
var db = null

function getDatabase() {
    if (db === null) {
        db = LS.LocalStorage.openDatabaseSync(DB_NAME, DB_VERSION, DB_DESCRIPTION, DB_SIZE)

        db.transaction(function(tx) {
            tx.executeSql('CREATE TABLE IF NOT EXISTS todos(id INTEGER PRIMARY KEY, title TEXT, completed INTEGER, created_at TEXT)')
        })
    }
    return db
}

function initDatabase(plasmoid) {
    getDatabase()
    const todos = getAllTodos(plasmoid)
    if (todos.length > 0) {
        // Find the highest ID
        var maxId = 0
        for (var i = 0; i < todos.length; i++) {
            if (todos[i].id > maxId) {
                maxId = todos[i].id
            }
        }
        nextId = maxId + 1
    }
}

function getAllTodos(plasmoid) {
    var todos = []
    var database = getDatabase()

    database.readTransaction(function(tx) {
        var rs = tx.executeSql('SELECT * FROM todos ORDER BY completed ASC, created_at DESC')
        for (var i = 0; i < rs.rows.length; i++) {
            var row = rs.rows.item(i)
            todos.push({
                id: row.id,
                title: row.title,
                completed: row.completed === 1,
                created_at: row.created_at
            })
        }
    })

    return todos
}

function saveTodos(plasmoid, todos) {
    // Not used anymore - direct DB operations
}

function addTodo(plasmoid, title) {
    var database = getDatabase()
    var todoId = nextId++

    database.transaction(function(tx) {
        tx.executeSql('INSERT INTO todos (id, title, completed, created_at) VALUES (?, ?, ?, ?)',
                     [todoId, title, 0, new Date().toISOString()])
    })

    return todoId
}

function toggleTodo(plasmoid, id) {
    var database = getDatabase()

    database.transaction(function(tx) {
        tx.executeSql('UPDATE todos SET completed = NOT completed WHERE id = ?', [id])
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
    })
}

function loadSampleData(plasmoid) {
    clearAll(plasmoid)

    var database = getDatabase()
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)

    const twoDaysAgo = new Date(now)
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

    const lastWeek = new Date(now)
    lastWeek.setDate(lastWeek.getDate() - 7)

    const sampleTodos = [
        // Today
        { title: "Buy bread", completed: 0, created_at: now.toISOString() },
        { title: "Call the dentist", completed: 0, created_at: now.toISOString() },
        { title: "Finish the report", completed: 1, created_at: now.toISOString() },
        { title: "Reply to emails", completed: 0, created_at: now.toISOString() },
        { title: "Visit https://github.com/monkeydzeke/interval-taskify", completed: 0, created_at: now.toISOString() },

        // Yesterday
        { title: "Go grocery shopping", completed: 1, created_at: yesterday.toISOString() },
        { title: "Pay the bills", completed: 1, created_at: yesterday.toISOString() },
        { title: "Clean the kitchen", completed: 0, created_at: yesterday.toISOString() },

        // 2 days ago
        { title: "Team meeting", completed: 1, created_at: twoDaysAgo.toISOString() },
        { title: "Prepare presentation", completed: 1, created_at: twoDaysAgo.toISOString() },
        { title: "Review the budget", completed: 0, created_at: twoDaysAgo.toISOString() },

        // Last week
        { title: "Doctor's appointment", completed: 1, created_at: lastWeek.toISOString() },
        { title: "Buy a birthday gift", completed: 1, created_at: lastWeek.toISOString() },
        { title: "Repair the bike", completed: 0, created_at: lastWeek.toISOString() }
    ]

    database.transaction(function(tx) {
        for (var i = 0; i < sampleTodos.length; i++) {
            tx.executeSql('INSERT INTO todos (id, title, completed, created_at) VALUES (?, ?, ?, ?)',
                         [i + 1, sampleTodos[i].title, sampleTodos[i].completed, sampleTodos[i].created_at])
        }
    })

    nextId = sampleTodos.length + 1
}
