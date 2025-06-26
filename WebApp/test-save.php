<?php
// Test writing to cases.json
$testData = json_encode([
    [
        "name" => "Test Case",
        "prompt" => "This is a test case",
        "timestamp" => date('c')
    ]
]);

// Write to file
$result = file_put_contents('cases.json', $testData);

if ($result === false) {
    echo "ERROR: Failed to write to cases.json<br>";
    echo "Error: " . error_get_last()['message'];
} else {
    echo "SUCCESS: Wrote $result bytes to cases.json<br>";
    echo "File content:<br>";
    echo "<pre>" . htmlspecialchars(file_get_contents('cases.json')) . "</pre>";
}
?> 