.pragma library

const baseUrl = "http://localhost:8085/api/v1"

function request(method, path, body, callback) {
  const xhr = new XMLHttpRequest()
  xhr.open(method, baseUrl + path, true)
  xhr.setRequestHeader("Content-Type", "application/json")
  xhr.timeout = 3000

  xhr.onreadystatechange = function () {
    if (xhr.readyState === XMLHttpRequest.DONE) {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText)
          callback(null, response)
        } catch (e) {
          callback({ error: "Invalid JSON response" }, null)
        }
      } else {
        callback({ status: xhr.status, text: xhr.responseText }, null)
      }
    }
  }

  xhr.ontimeout = function () {
    callback({ error: "Request timed out" }, null)
  }

  xhr.onerror = function () {
    callback({ error: "Network error connecting to backend service" }, null)
  }

  if (body) {
    xhr.send(JSON.stringify(body))
  } else {
    xhr.send()
  }
}

function getTasks(filter, callback) {
  const query = filter ? "?filter=" + encodeURIComponent(filter) : ""
  request("GET", "/tasks" + query, null, callback)
}

function getSummary(energyFactor, callback) {
  const query = energyFactor ? "?energy_factor=" + encodeURIComponent(energyFactor) : ""
  request("GET", "/summary" + query, null, callback)
}

function addTask(title, config, callback) {
  const payload = {
    title: title,
    interval_days: config.interval_days || 7,
    days_ago: config.days_ago || 0,
    significance: config.significance || 1.0,
    effort: config.effort || 1.0,
    domain: config.domain || "executive_mental",
    is_recurring: config.is_recurring !== false
  }
  request("POST", "/tasks", payload, callback)
}

function updateTask(id, title, config, callback) {
  const payload = {
    title: title,
    interval_days: config.interval_days,
    days_ago: config.days_ago,
    significance: config.significance,
    effort: config.effort,
    domain: config.domain,
    is_recurring: config.is_recurring
  }
  request("PUT", "/tasks/" + id, payload, callback)
}

function completeTask(id, callback) {
  request("POST", "/tasks/" + id + "/complete", null, callback)
}

function setTaskState(id, state, callback) {
  request("PATCH", "/tasks/" + id + "/state", { state: state }, callback)
}

function deleteTask(id, callback) {
  request("DELETE", "/tasks/" + id, null, callback)
}

function exportData(callback) {
  request("GET", "/export", null, callback)
}

function importData(payload, callback) {
  request("POST", "/import", payload, callback)
}
