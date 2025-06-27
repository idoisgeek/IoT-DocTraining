
from mfrc522 import SimpleMFRC522
import RPi.GPIO as GPIO

reader = SimpleMFRC522()
while True: 
	print("Place your RFID tag near the reader...")
	id,text = reader.read()
	print(f"Tag ID: {id}")
	print(f"Text: {text}")
