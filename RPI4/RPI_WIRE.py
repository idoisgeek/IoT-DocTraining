import sys
import wave
import pyaudio
import random
import threading
import time
import queue
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout,
                             QHBoxLayout, QPushButton, QLabel, QStackedWidget,
                             QListWidget, QListWidgetItem, QGridLayout, QMessageBox,
                             QScrollArea)
from PyQt5.QtCore import Qt, pyqtSignal, QThread, QSize
from PyQt5.QtGui import QFont
from mfrc522 import SimpleMFRC522
import RPi.GPIO as GPIO
import os


class RFIDReaderThread(QThread):
    tag_detected = pyqtSignal(str)
    tag_removed = pyqtSignal()
    
    def __init__(self):
        super().__init__()
        self.reader = SimpleMFRC522()
        self.running = True
        self.current_tag_id = None
        
    def run(self):
        try:
            print("RFID reader thread started...")
            while self.running:
                try:
                    # Try to read a tag with a timeout
                    tag_id = self.read_tag_with_timeout(0.5)
                    
                    if tag_id is not None:
                        # Tag detected
                        if self.current_tag_id != tag_id:
                            print(f"Tag detected: {tag_id}")
                            self.current_tag_id = tag_id
                            self.tag_detected.emit(str(tag_id))
                    else:
                        # No tag present
                        if self.current_tag_id is not None:
                            print("Tag removed")
                            self.current_tag_id = None
                            self.tag_removed.emit()
                    
                    time.sleep(0.1)  # Small delay to prevent CPU hogging
                    
                except Exception as e:
                    print(f"Error in RFID reader thread: {e}")
                    time.sleep(0.5)
        finally:
            print("RFID reader thread stopped")
    
    def read_tag_with_timeout(self, timeout):
        """Read tag with timeout using multiprocessing"""
        from multiprocessing import Process, Pipe
        
        def read_tag(conn):
            try:
                id, text = self.reader.read()
                if id is not None:
                    conn.send(id)
                else:
                    conn.send(None)
            except:
                conn.send(None)
            finally:
                conn.close()
        
        parent_conn, child_conn = Pipe()
        p = Process(target=read_tag, args=(child_conn,))
        p.start()
        
        # Wait for read with timeout
        p.join(timeout)
        
        if p.is_alive():
            # Read is taking too long, tag probably removed
            p.terminate()
            p.join()
            return None
        else:
            # We got a read result
            if parent_conn.poll():
                return parent_conn.recv()
            return None
    
    def stop(self):
        self.running = False
        self.wait()


class SoundManager:
    def __init__(self, sound_map):
        self.sound_map = sound_map
        self.command_queue = queue.Queue()
        self.stop_event = threading.Event()
        self.audio_thread = threading.Thread(target=self._audio_loop)
        self.lock = threading.Lock()
        self.p = pyaudio.PyAudio()
        self.stream = None
        self.is_playing = False
        self.currently_playing_key = None
    
    def start(self):
        self.audio_thread.start()
    
    def join(self):
        self.audio_thread.join()
    
    def _play_file(self, file_name, play_key):
        self.is_playing = True
        self.currently_playing_key = play_key
        
        try:
            # Open the wave file
            wf = wave.open(file_name, 'rb')
            speed_factor = random.uniform(0.8, 1.2)
            original_rate = wf.getframerate()
            new_rate = int(original_rate * speed_factor)
            
            # Loop continuously while key is active
            while self.currently_playing_key == play_key and not self.stop_event.is_set():
                # Reopen file if we reached the end
                if wf.tell() >= wf.getnframes():
                    wf.rewind()
                
                # Create and setup stream
                self.stream = self.p.open(format=self.p.get_format_from_width(wf.getsampwidth()),
                                          channels=wf.getnchannels(),
                                          rate=new_rate,
                                          output=True)
                
                # Read a chunk of data and play it
                data = wf.readframes(1024)
                while data and self.currently_playing_key == play_key and not self.stop_event.is_set():
                    self.stream.write(data)
                    data = wf.readframes(1024)
                
                # Close the stream
                if self.stream:
                    self.stream.stop_stream()
                    self.stream.close()
                    self.stream = None
        except Exception as e:
            print(f"Error playing audio: {e}")
        finally:
            # Final cleanup
            if 'wf' in locals() and hasattr(wf, 'close'):
                wf.close()
            if self.stream:
                self.stream.stop_stream()
                self.stream.close()
                self.stream = None
            self.is_playing = False
            self.currently_playing_key = None
    
    def _audio_loop(self):
        while not self.stop_event.is_set():
            try:
                # Get command with short timeout to allow for frequent checking
                play_key = self.command_queue.get(timeout=0.1)
                
                # Check if we need to stop current playback before starting new one
                if self.is_playing and self.currently_playing_key != play_key:
                    self.currently_playing_key = None
                    time.sleep(0.2)  # Give time for playback to stop
                
                # Play the audio if key exists in sound map
                if play_key in self.sound_map:
                    self._play_file(self.sound_map[play_key], play_key)
            
            except queue.Empty:
                continue
        
        # Cleanup when thread is stopping
        if self.stream:
            self.stream.stop_stream()
            self.stream.close()
        self.p.terminate()
    
    def stop_current_playback(self):
        """Stop the currently playing audio"""
        self.currently_playing_key = None

    def update_sound_map(self, new_map):
        """Update the sound map with new mappings"""
        #with self.lock:
            #self.sound_map = new_map


class CaseSelectorApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.current_case = None
        self.current_tag_id = None
        self.sound_map = {}
        
        # Set fixed size for 3.5 inch LCD (480x320)
        self.setFixedSize(480, 320)
        
        # Sound mapping format: (case_id, tag_id): sound_file_path
        base_path = 'sounds'
        self.num_total_cases = len(os.listdir(base_path))
        for case_num in os.listdir(base_path):
                case_path = os.path.join(base_path, case_num)
                self.sound_map[(case_num, "471368653771")] = os.path.join(case_path, "spot1.wav")
                self.sound_map[(case_num, "236536494835")] = os.path.join(case_path, "spot2.wav")
                # Add more mappings as needed
        
        # Initialize sound manager
        self.sound_manager = SoundManager(self.sound_map)
        self.sound_manager.start()
        
        # Initialize RFID reader in a separate thread
        self.rfid_thread = RFIDReaderThread()
        self.rfid_thread.tag_detected.connect(self.on_tag_detected)
        self.rfid_thread.tag_removed.connect(self.on_tag_removed)
        
        # Initialize UI
        self.initUI()
        
        # Start RFID reader thread
        self.rfid_thread.start()
    
    def initUI(self):
        # Set up the main window
        self.setWindowTitle('Case Selector')
        
        # Create stacked widget to manage different screens
        self.stacked_widget = QStackedWidget(self)
        self.setCentralWidget(self.stacked_widget)
        
        # Create main menu screen
        self.create_main_menu()
        
        # Create case view screen
        self.create_case_view()
        
        # Start with main menu
        self.stacked_widget.setCurrentIndex(0)
        
        # Set to full screen mode
        self.showFullScreen()
    
    def create_main_menu(self):
        main_menu = QWidget()
        
        # Create scroll area to ensure all content is accessible on small screen
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setWidget(main_menu)
        
        layout = QVBoxLayout(main_menu)
        layout.setSpacing(2)  # Reduce spacing between elements
        layout.setContentsMargins(5, 5, 5, 5)  # Reduce margins
        
        # Title
        title_label = QLabel('Case Selector')
        title_font = QFont()
        title_font.setPointSize(14)  # Smaller font size
        title_font.setBold(True)
        title_label.setFont(title_font)
        title_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(title_label)
        
        # Subtitle
        subtitle_label = QLabel('Select case & scan RFID tags')
        subtitle_font = QFont()
        subtitle_font.setPointSize(10)  # Smaller font size
        subtitle_label.setFont(subtitle_font)
        subtitle_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(subtitle_label)
        
        # Create RFID status label
        self.rfid_status_label = QLabel('RFID Status: No tag detected')
        status_font = QFont()
        status_font.setPointSize(9)  # Smaller font size
        self.rfid_status_label.setFont(status_font)
        self.rfid_status_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.rfid_status_label)
        
        # Create case selection grid (3x4 grid for better fit on small screen)
        grid_layout = QGridLayout()
        grid_layout.setSpacing(4)  # Smaller spacing
        case_num = 1
        for row in range(4):  # More rows, fewer columns for better fit
            for col in range(3):
                if case_num <= self.num_total_cases:
                    button = QPushButton(f'Case {case_num}')
                    button.setMinimumHeight(35)  # Smaller height
                    button.setMinimumWidth(60)   # Smaller width
                    button_font = QFont()
                    button_font.setPointSize(10)  # Smaller font size
                    button.setFont(button_font)
                    button.case_number = case_num
                    button.clicked.connect(self.select_case)
                    grid_layout.addWidget(button, row, col)
                    case_num += 1
        
        layout.addLayout(grid_layout)
        
        # Bottom buttons in 2 rows for better fit
        btn_font = QFont()
        btn_font.setPointSize(9)  # Smaller font size
        
        # First row of buttons
        top_buttons = QHBoxLayout()
        view_mappings_button = QPushButton('Sound Mappings')
        view_mappings_button.setMinimumHeight(30)  # Smaller height
        view_mappings_button.setFont(btn_font)
        view_mappings_button.clicked.connect(self.show_sound_mappings)
        top_buttons.addWidget(view_mappings_button)
        
        toggle_button = QPushButton('Exit Fullscreen')
        toggle_button.setMinimumHeight(30)  # Smaller height
        toggle_button.setFont(btn_font)
        toggle_button.clicked.connect(self.toggle_fullscreen)
        top_buttons.addWidget(toggle_button)
        
        layout.addLayout(top_buttons)
        
        # Second row with exit button
        bottom_buttons = QHBoxLayout()
        exit_button = QPushButton('Exit')
        exit_button.setMinimumHeight(30)  # Smaller height
        exit_button.setFont(btn_font)
        exit_button.clicked.connect(self.close_application)
        bottom_buttons.addWidget(exit_button)
        
        layout.addLayout(bottom_buttons)
        
        # Add to stacked widget
        self.stacked_widget.addWidget(scroll_area)
    
    def create_case_view(self):
        case_view = QWidget()
        
        # Create scroll area for case view
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setWidget(case_view)
        
        layout = QVBoxLayout(case_view)
        layout.setSpacing(5)  # Reduce spacing between elements
        layout.setContentsMargins(5, 5, 5, 5)  # Reduce margins
        
        # Case title
        self.case_title = QLabel('Case Details')
        title_font = QFont()
        title_font.setPointSize(14)  # Smaller font size
        title_font.setBold(True)
        self.case_title.setFont(title_font)
        self.case_title.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.case_title)
        
        # RFID status in case view
        self.case_rfid_status = QLabel('RFID Status: No tag detected')
        status_font = QFont()
        status_font.setPointSize(9)  # Smaller font size
        self.case_rfid_status.setFont(status_font)
        self.case_rfid_status.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.case_rfid_status)
        
        # Case information
        self.case_info = QLabel()
        info_font = QFont()
        info_font.setPointSize(10)  # Smaller font size
        self.case_info.setFont(info_font)
        self.case_info.setAlignment(Qt.AlignCenter)
        self.case_info.setWordWrap(True)  # Enable word wrap for better display
        layout.addWidget(self.case_info)
        
        # Sound playback status
        self.sound_status = QLabel('Sound Status: No sound playing')
        self.sound_status.setFont(status_font)
        self.sound_status.setAlignment(Qt.AlignCenter)
        self.sound_status.setWordWrap(True)  # Enable word wrap
        layout.addWidget(self.sound_status)
        
        layout.addStretch()
        
        # Return to main menu button
        return_button = QPushButton('Return to Main Menu')
        return_button.setMinimumHeight(40)  # Good size for touch
        button_font = QFont()
        button_font.setPointSize(10)  # Smaller font size
        return_button.setFont(button_font)
        return_button.clicked.connect(self.return_to_menu)
        layout.addWidget(return_button, 0, Qt.AlignCenter)
        
        # Add to stacked widget
        self.stacked_widget.addWidget(scroll_area)
    
    def select_case(self):
        sender = self.sender()
        self.current_case = sender.case_number
        
        
        # Update case view with selected case information
        self.case_title.setText(f'Case {self.current_case}')
        self.case_info.setText(f'You selected Case {self.current_case}.\n\n'
                              f'Present an RFID tag to play the associated sound.')
        
        # Check if there's already a tag present and update sound
        if self.current_tag_id is not None:
            self.update_sound_playback()
        
        # Switch to case view
        self.stacked_widget.setCurrentIndex(1)
    
    def on_tag_detected(self, tag_id):
        self.current_tag_id = tag_id
        
        # Update RFID status labels
        self.rfid_status_label.setText(f'RFID Status: Tag {self.current_tag_id} detected')
        self.case_rfid_status.setText(f'RFID Status: Tag {self.current_tag_id} detected')
        
        # Update sound playback if we have a selected case
        if self.current_case is not None:
            self.update_sound_playback()
    
    def on_tag_removed(self):
        self.current_tag_id = None
        
        # Update RFID status labels
        self.rfid_status_label.setText('RFID Status: No tag detected')
        self.case_rfid_status.setText('RFID Status: No tag detected')
        
        # Stop any playing sound
        self.sound_manager.stop_current_playback()
        self.sound_status.setText('Sound Status: No sound playing')
    
    def update_sound_playback(self):
        # Stop any currently playing sound first
        self.sound_manager.stop_current_playback()
        
        # Create a tuple key for the sound map
        sound_key = (f"case{self.current_case}" ,self.current_tag_id)
        
        if sound_key in self.sound_map:
            # Play the corresponding sound
            self.sound_manager.command_queue.put(sound_key)
            self.sound_status.setText(f'Sound Status: Playing sound for Case {self.current_case}, Tag {self.current_tag_id}')
            print(f"Playing sound for key: {sound_key}")
        else:
            # No sound mapping for this combination
            self.sound_status.setText(f'Sound Status: No sound mapped for Case {self.current_case}, Tag {self.current_tag_id}')
            print(f"No sound mapping for key: {sound_key}")
    
    def show_sound_mappings(self):
        # Create a dialog to show sound mappings
        mappings_dialog = QMessageBox(self)
        mappings_dialog.setWindowTitle("Sound Mappings")
        
        # Create text for all mappings
        mappings_text = "Current Sound Mappings:\n\n"
        for key, value in self.sound_map.items():
            case_id, tag_id = key
            mappings_text += f"Case {case_id}, Tag {tag_id}: {value}\n"
        
        mappings_dialog.setText(mappings_text)
        mappings_dialog.setStandardButtons(QMessageBox.Ok)
        
        # Make dialog fit on small screen
        mappings_dialog.setStyleSheet("QLabel{min-width: 450px; font-size: 9pt;}")
        
        mappings_dialog.exec_()
    
    def return_to_menu(self):
        # Switch back to main menu
        self.stacked_widget.setCurrentIndex(0)
    
    def toggle_fullscreen(self):
        if self.isFullScreen():
            self.showNormal()
            # Find and update the toggle button text
            for child in self.findChildren(QPushButton):
                if 'fullscreen' in child.text().lower():
                    child.setText('Enter Fullscreen')
                    break
        else:
            self.showFullScreen()
            # Find and update the toggle button text
            for child in self.findChildren(QPushButton):
                if 'fullscreen' in child.text().lower():
                    child.setText('Exit Fullscreen')
                    break
    
    def keyPressEvent(self, event):
        # Handle ESC key to exit fullscreen
        if event.key() == Qt.Key_Escape:
            if self.isFullScreen():
                self.showNormal()
                # Find and update the toggle button text
                for child in self.findChildren(QPushButton):
                    if 'fullscreen' in child.text().lower():
                        child.setText('Enter Fullscreen')
                        break
        else:
            super().keyPressEvent(event)
    
    def close_application(self):
        # Stop all running threads and processes before closing
        self.sound_manager.stop_event.set()
        self.rfid_thread.stop()
        self.sound_manager.join()
        try:
            rfid_pins = [16]
            for pin in rfid_pins:
                try:
                	GPIO.cleanup(pin)
                except:
                    pass
        except:
        	pass

        self.close()
    
    def closeEvent(self, event):
        # Make sure to stop all threads and clean up when window is closed
        self.sound_manager.stop_event.set()
        self.rfid_thread.stop()
        self.sound_manager.join()
        try:
            rfid_pins = [16]
            for pin in rfid_pins:
                try:
                    GPIO.cleanup(pin)
                except:
                    pass
        except:
            pass
        
        event.accept()


def main():
    app = QApplication(sys.argv)
    window = CaseSelectorApp()
    window.show()
    sys.exit(app.exec_())


if __name__ == '__main__':
    main()