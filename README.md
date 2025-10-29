# ReadMe

**模擬授業登録コマンド**
```
curl -X POST http://18.214.16.68:3000/lecture/create   
 -H "Content-Type: multipart/form-data"
 -F "lecture_name=模擬授業A"
 -F "outline_pdf=@/mnt/c/Downloads/test_A.pdf"
 -F "staff_names[]=山田太郎"
 -F "staff_names[]=佐藤花子"
 -F "location=教室101"
 -F "max_capacity=30"
 -F "dates[]=2025-11-01"
 -F "dates[]=2025-11-02"
 -F "sessions[0][date]=2025-11-01"
 -F "sessions[0][start_time]=10:00"
 -F "sessions[0][end_time]=11:00"
 -F "sessions[1][date]=2025-11-01"
 -F "sessions[1][start_time]=13:00"
 -F "sessions[1][end_time]=14:00"
 -F "sessions[2][date]=2025-11-02"
 -F "sessions[2][start_time]=10:00" 
 -F "sessions[2][end_time]=11:00"
```
