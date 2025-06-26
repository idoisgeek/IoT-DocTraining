Doctor Training Project

By Ido Ofir, Topaz Shalom, Erel Kaplan

Project Overview:
Anamnesis and Auscultation Training Simulation
Medical students often lack sufficient opportunities to practice anamnesis and physical examination techniques.

This project introduces a configurable diagnostic simulation platform aimed at improving medical training:

Interactive AI-based chat interface for conducting virtual patient interviews.
Smart stethoscope that simulates auscultation at specific body locations, customized per clinical case.
Real-time diagnostic feedback to support learning and skill improvement.


Folder Description:
ESP32/ — Code for ESP32 to read remote Bluetooth tag IDs.
RPI/ — Two implementations:
BT remote tag reading using ESP32.
Wired version for reading and playing sounds locally.
WebApp/ — Web app code for interactive anamnesis training. Runs locally using npm.
ASSETS/ — General and review prompts, three clinical cases, each including:
Case description
Four heart sound files
SECRETS/ — Contains OpenAI API key

Libraries Used:
ESP32: MFRC522 = 1.4.12, BluetoothSerial = 1.1.0
Raspberry Pi (RPI): pyaudio, PyQt5, MFRC522, GPIO, serial

Hardware Setup:
![Smart Stethoscope Diagram](finalScheme.pdf)

Components Used:

ESP32 ×1
Raspberry Pi 4 ×1
RC522 RFID Reader ×1
TFT 3.5" Display ×1
Bluetooth Speaker ×1
ESP Battery Shield ×1
Li-Ion Battery for ESP ×1

Project Poster:
![Poster](Poster.pdf)
