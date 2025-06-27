RPI_BT.py – Python script for the Bluetooth version.
In this setup, the RFID reader is connected to an ESP32, which sends scanned IDs via Bluetooth to the Raspberry Pi. The Raspberry Pi then plays the corresponding sound through a Bluetooth speaker.

RPI_WIRE.py – Python script for the wired version.
In this version, both the RFID reader and the speaker are directly connected to the Raspberry Pi using GPIO pins and the AUX port.

shortcut_script – Setup script for the Bluetooth version.
This script creates a desktop shortcut that automatically connects the Raspberry Pi to both the ESP32 and the Bluetooth speaker (using their MAC addresses) on each startup.

shortcut_code_WIRE - Setup for the wire version.
A desktop shortcut code to launch application.
